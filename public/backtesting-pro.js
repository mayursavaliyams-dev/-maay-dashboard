const state = {
  apiBase: localStorage.getItem("ag_bt_api_base") || "http://localhost:8000",
  datasetId: localStorage.getItem("ag_bt_dataset_id") || "",
  currentJobId: "",
  charts: {},
  lastResult: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  attachEvents();
  seedDefaults();
  loadStrategies();
  checkHealth();
});

function bindElements() {
  [
    "apiBase", "csvFile", "datasetMeta", "datasetId", "dataPath", "index", "timeframe", "strategy",
    "startDate", "endDate", "capital", "lotSize", "stopLoss", "target", "trailingSl",
    "brokerage", "slippage", "capitalAllocation", "apiHealthPill", "jobDot", "jobStatus",
    "jobMessage", "downloadReport", "rankingCards", "bestStrategyCard", "tradeTableBody",
    "aiExplanations", "btnReloadMeta", "btnCheckHealth", "btnUpload", "btnRun", "btnPaperStart", "btnPaperStop",
    "btnLoadDatasets", "datasetSelect",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function attachEvents() {
  els.btnReloadMeta.addEventListener("click", loadStrategies);
  els.btnCheckHealth.addEventListener("click", checkHealth);
  els.btnLoadDatasets.addEventListener("click", loadDatasets);
  els.btnUpload.addEventListener("click", uploadCsv);
  els.btnRun.addEventListener("click", runBacktest);
  els.btnPaperStart.addEventListener("click", startPaperTrading);
  els.btnPaperStop.addEventListener("click", stopPaperTrading);
  els.apiBase.addEventListener("change", () => {
    state.apiBase = els.apiBase.value.trim().replace(/\/$/, "");
    localStorage.setItem("ag_bt_api_base", state.apiBase);
    checkHealth();
  });
  els.index.addEventListener("change", () => {
    const map = { NIFTY: 50, BANKNIFTY: 65, SENSEX: 10, ALL: 50 };
    els.lotSize.value = map[els.index.value] || 50;
  });
  els.datasetSelect.addEventListener("change", () => {
    const selected = els.datasetSelect.selectedOptions[0];
    if (!selected || !selected.value) {
      return;
    }
    els.datasetId.value = selected.value;
    state.datasetId = selected.value;
    localStorage.setItem("ag_bt_dataset_id", state.datasetId);
    els.datasetMeta.textContent = selected.dataset.meta || `Dataset selected: ${selected.value}`;
  });
}

function seedDefaults() {
  els.apiBase.value = state.apiBase;
  els.datasetId.value = state.datasetId;
  els.endDate.value = new Date().toISOString().slice(0, 10);
  renderEmptyCharts();
}

async function loadStrategies() {
  try {
    const response = await apiFetch("/strategies/list");
    const strategies = response.strategies || [];
    els.strategy.innerHTML = '<option value="all">All Strategies</option>' + strategies
      .map((item) => `<option value="${item.code}">${item.name}</option>`)
      .join("");
    await loadDatasets();
  } catch (error) {
    setStatus("error", "Strategy load failed", error.message);
  }
}

async function checkHealth() {
  try {
    const health = await apiFetch("/health");
    els.apiHealthPill.textContent = `API: ${health.status} | datasets ${health.datasets} | jobs ${health.jobs_completed}`;
    els.apiHealthPill.style.borderColor = "rgba(100, 241, 214, 0.45)";
  } catch (error) {
    els.apiHealthPill.textContent = `API: offline (${error.message})`;
    els.apiHealthPill.style.borderColor = "rgba(255, 107, 107, 0.45)";
  }
}

async function uploadCsv() {
  const file = els.csvFile.files[0];
  if (!file) {
    setStatus("error", "Upload aborted", "Choose a CSV file first.");
    return;
  }
  try {
    setStatus("running", "Uploading dataset", file.name);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${state.apiBase}/data/upload`, { method: "POST", body: formData });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    state.datasetId = payload.dataset_id;
    localStorage.setItem("ag_bt_dataset_id", state.datasetId);
    els.datasetId.value = state.datasetId;
    els.datasetMeta.textContent = `${payload.filename} uploaded. Detected columns: ${(payload.inspection?.columns || []).join(", ")}`;
    await loadDatasets();
    setStatus("done", "Dataset uploaded", state.datasetId);
  } catch (error) {
    setStatus("error", "Upload failed", simplifyError(error));
  }
}

async function loadDatasets() {
  try {
    const response = await apiFetch("/data/list");
    const datasets = response.datasets || [];
    els.datasetSelect.innerHTML = '<option value="">Select uploaded dataset</option>' + datasets
      .map((item) => {
        const meta = `${item.filename} | ${item.dataset_id} | ${item.uploaded_at}`;
        const selected = item.dataset_id === (els.datasetId.value.trim() || state.datasetId) ? "selected" : "";
        return `<option value="${item.dataset_id}" data-meta="${meta}" ${selected}>${item.filename} (${item.dataset_id})</option>`;
      })
      .join("");
    if (datasets.length) {
      const current = datasets.find((item) => item.dataset_id === (els.datasetId.value.trim() || state.datasetId)) || datasets[0];
      if (!els.datasetId.value.trim()) {
        els.datasetId.value = current.dataset_id;
        state.datasetId = current.dataset_id;
        localStorage.setItem("ag_bt_dataset_id", state.datasetId);
      }
      els.datasetMeta.textContent = `${current.filename} uploaded ${current.uploaded_at}`;
    }
  } catch (error) {
    els.datasetMeta.textContent = `Dataset list unavailable: ${simplifyError(error)}`;
  }
}

async function runBacktest() {
  try {
    const body = collectRequestBody();
    setStatus("running", "Submitting backtest", `${body.index} | ${body.strategy}`);
    const response = await apiFetch("/backtest/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.currentJobId = response.job_id;
    pollJob(response.job_id);
  } catch (error) {
    setStatus("error", "Backtest launch failed", simplifyError(error));
  }
}

async function pollJob(jobId) {
  const timer = setInterval(async () => {
    try {
      const status = await apiFetch(`/backtest/status/${jobId}`);
      setStatus(status.status === "completed" ? "done" : status.status === "failed" ? "error" : "running", status.status, status.message || "");
      if (status.status === "completed") {
        clearInterval(timer);
        const result = await apiFetch(`/backtest/result/${jobId}`);
        state.lastResult = result;
        renderResult(result);
      }
      if (status.status === "failed") {
        clearInterval(timer);
      }
    } catch (error) {
      clearInterval(timer);
      setStatus("error", "Polling failed", simplifyError(error));
    }
  }, 1500);
}

async function startPaperTrading() {
  try {
    const body = {
      index: els.index.value,
      strategy: els.strategy.value === "all" ? "combined_ai" : els.strategy.value,
      timeframe: els.timeframe.value,
      dataset_id: els.datasetId.value.trim() || undefined,
      data_path: els.dataPath.value.trim() || undefined,
    };
    const result = await apiFetch("/paper/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setStatus(result.running ? "running" : "done", "Paper trading", `${body.strategy} on ${body.index}`);
  } catch (error) {
    setStatus("error", "Paper start failed", simplifyError(error));
  }
}

async function stopPaperTrading() {
  try {
    await apiFetch("/paper/stop", { method: "POST" });
    setStatus("done", "Paper trading stopped", "Simulation halted");
  } catch (error) {
    setStatus("error", "Paper stop failed", simplifyError(error));
  }
}

function collectRequestBody() {
  return {
    index: els.index.value,
    strategy: els.strategy.value,
    start_date: els.startDate.value,
    end_date: els.endDate.value,
    capital: Number(els.capital.value),
    lot_size: els.lotSize.value ? Number(els.lotSize.value) : undefined,
    stop_loss: Number(els.stopLoss.value),
    target: Number(els.target.value),
    trailing_sl: Number(els.trailingSl.value),
    timeframe: els.timeframe.value,
    brokerage: Number(els.brokerage.value),
    slippage: Number(els.slippage.value),
    capital_allocation: Number(els.capitalAllocation.value),
    dataset_id: els.datasetId.value.trim() || undefined,
    data_path: els.dataPath.value.trim() || undefined,
  };
}

function renderResult(result) {
  const ranking = result.ranking?.ranking || [];
  const best = result.ranking?.best_overall_strategy;
  renderRankingCards(ranking);
  renderBestStrategy(best, result.strategy_results || []);
  renderTrades(result.strategy_results || [], best);
  renderExplanations(result.strategy_results || []);
  renderCharts(result.strategy_results || [], best);
  els.downloadReport.href = `${state.apiBase}/backtest/report/${result.job_id}`;
  els.downloadReport.classList.remove("disabled-link");
}

function renderRankingCards(ranking) {
  if (!ranking.length) {
    els.rankingCards.innerHTML = '<section class="card metric-card"><div class="empty">No ranking data available.</div></section>';
    return;
  }
  els.rankingCards.innerHTML = ranking.slice(0, 4).map((item) => `
    <section class="card metric-card">
      <div class="metric-label">${item.index}</div>
      <div class="metric-value">${item.score}</div>
      <div>${item.strategy}</div>
      <div class="micro">Win ${formatNumber(item.win_rate)}% | P&L ₹${formatMoney(item.net_pnl)}</div>
    </section>
  `).join("");
}

function renderBestStrategy(best, strategyResults) {
  if (!best) {
    els.bestStrategyCard.innerHTML = '<div class="card-title">Best Strategy</div><div class="empty">No best strategy available.</div>';
    return;
  }
  const detail = strategyResults.find((item) => item.strategy === best.strategy && item.index === best.index) || strategyResults[0];
  const metrics = detail?.metrics || {};
  els.bestStrategyCard.innerHTML = `
    <div class="card-title">Best Strategy</div>
    <h2>${best.strategy} <span class="micro">(${best.index})</span></h2>
    <p class="micro">${best.description || ""}</p>
    <div class="best-grid">
      <div><div class="metric-label">AI Score</div><div class="metric-value">${formatNumber(best.score)}</div></div>
      <div><div class="metric-label">Net P&amp;L</div><div class="metric-value">₹${formatMoney(metrics.net_pnl || 0)}</div></div>
      <div><div class="metric-label">Win Rate</div><div class="metric-value">${formatNumber(metrics.win_rate || 0)}%</div></div>
      <div><div class="metric-label">Max DD</div><div class="metric-value">${formatNumber(metrics.max_drawdown_pct || 0)}%</div></div>
    </div>
  `;
}

function renderTrades(strategyResults, best) {
  const allTrades = strategyResults.flatMap((item) => item.trades.map((trade) => ({ ...trade, strategy: item.strategy, index: item.index })));
  const focusTrades = best
    ? allTrades.filter((trade) => trade.strategy === best.strategy && trade.index === best.index)
    : allTrades;
  const rows = focusTrades.slice(0, 200);
  if (!rows.length) {
    els.tradeTableBody.innerHTML = '<tr><td colspan="9" class="empty-cell">No trades produced for the current selection.</td></tr>';
    return;
  }
  els.tradeTableBody.innerHTML = rows.map((trade) => `
    <tr>
      <td>${formatDateTime(trade.entry_time)}</td>
      <td>${trade.strategy}</td>
      <td>${trade.index}</td>
      <td>${trade.signal}</td>
      <td>${trade.quantity}</td>
      <td>${formatNumber(trade.entry_price)}</td>
      <td>${formatNumber(trade.exit_price)}</td>
      <td class="${trade.net_pnl >= 0 ? "pnl-pos" : "pnl-neg"}">₹${formatMoney(trade.net_pnl)}</td>
      <td>${trade.exit_reason}</td>
    </tr>
  `).join("");
}

function renderExplanations(strategyResults) {
  const notes = strategyResults.flatMap((item) => item.trades.map((trade) => ({
    strategy: item.strategy,
    index: item.index,
    entry_time: trade.entry_time,
    signal: trade.signal,
    confidence: trade.confidence,
    reasons: trade.reasons || [],
  }))).slice(0, 50);
  if (!notes.length) {
    els.aiExplanations.innerHTML = '<div class="empty">Signal explanations will appear after a completed run.</div>';
    return;
  }
  els.aiExplanations.innerHTML = notes.map((note) => `
    <div class="signal-note">
      <strong>${note.strategy} | ${note.index} | ${note.signal} | ${formatNumber(note.confidence)}%</strong>
      <div class="micro">${formatDateTime(note.entry_time)}</div>
      <div>${note.reasons.join(" | ")}</div>
    </div>
  `).join("");
}

function renderCharts(strategyResults, best) {
  const detail = best
    ? strategyResults.find((item) => item.strategy === best.strategy && item.index === best.index)
    : strategyResults[0];
  const metrics = detail?.metrics || {};
  updateChart("equityChart", "line", metrics.equity_curve || [], "trade_date", "equity", "#64f1d6");
  updateChart("drawdownChart", "line", metrics.drawdown_curve || [], "trade_date", "drawdown", "#ff6b6b");
  updateChart("monthlyChart", "bar", metrics.monthly_returns || [], "month", "net_pnl", "#ffba6a");
}

function renderEmptyCharts() {
  updateChart("equityChart", "line", [], "label", "value", "#64f1d6");
  updateChart("drawdownChart", "line", [], "label", "value", "#ff6b6b");
  updateChart("monthlyChart", "bar", [], "label", "value", "#ffba6a");
}

function updateChart(canvasId, type, rows, labelKey, valueKey, color) {
  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }
  const ctx = document.getElementById(canvasId);
  state.charts[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels: rows.map((row) => row[labelKey]),
      datasets: [{
        label: valueKey,
        data: rows.map((row) => row[valueKey]),
        borderColor: color,
        backgroundColor: `${color}66`,
        tension: 0.25,
        fill: type === "line",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8ba0b8" }, grid: { color: "rgba(148,163,184,0.06)" } },
        y: { ticks: { color: "#8ba0b8" }, grid: { color: "rgba(148,163,184,0.06)" } },
      },
    },
  });
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function setStatus(mode, headline, message) {
  els.jobDot.className = `status-dot ${mode}`;
  els.jobStatus.textContent = headline;
  els.jobMessage.textContent = message;
}

function formatDateTime(value) {
  return value ? String(value).replace("T", " ").slice(0, 19) : "n/a";
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

function simplifyError(error) {
  return String(error.message || error).replaceAll('"', "");
}
