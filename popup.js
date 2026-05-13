const gainInput = document.querySelector("#gain");
const gainNumber = document.querySelector("#gainNumber");
const gainValue = document.querySelector("#gainValue");
const toggleButton = document.querySelector("#toggle");
const message = document.querySelector("#message");
const statusDot = document.querySelector("#statusDot");
const tabTitle = document.querySelector("#tabTitle");

let activeTabId = null;
let state = { active: false, gain: Number(gainInput.value) };

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  tabTitle.textContent = tab?.title
    ? `${tab.title} · Tab ${activeTabId}`
    : `Tab ${activeTabId}`;

  if (!activeTabId) {
    setMessage("Could not find the current tab.");
    toggleButton.disabled = true;
    return;
  }

  state = await sendToServiceWorker({ type: "GET_STATE", tabId: activeTabId });
  render();
}

gainInput.addEventListener("input", () => {
  updateGain(Number(gainInput.value));
});

gainNumber.addEventListener("input", () => {
  updateGain(Number(gainNumber.value));
});

gainNumber.addEventListener("change", () => {
  updateGain(clampGain(Number(gainNumber.value)));
});

toggleButton.addEventListener("click", async () => {
  if (!activeTabId) {
    return;
  }

  toggleButton.disabled = true;
  setMessage(state.active ? "Stopping boost..." : "Connecting this tab's audio...");

  try {
    const type = state.active ? "STOP_BOOST" : "START_BOOST";
    state = await sendToServiceWorker({
      type,
      tabId: activeTabId,
      gain: Number(gainInput.value)
    });
    render();
  } catch (error) {
    setMessage(error.message || "Something went wrong.");
  } finally {
    toggleButton.disabled = false;
  }
});

function render() {
  gainInput.value = String(state.gain);
  gainNumber.value = state.gain.toFixed(1);
  gainValue.value = `${state.gain.toFixed(1)}x`;
  toggleButton.textContent = state.active ? "Stop" : "Start";
  toggleButton.classList.toggle("secondary", state.active);
  statusDot.classList.toggle("active", state.active);
  setMessage(
    state.active
      ? `Boosting only Tab ${activeTabId}. Other tabs keep their own values.`
      : `Ready for Tab ${activeTabId}. Each tab is controlled separately.`
  );
}

function setMessage(text) {
  message.textContent = text;
}

async function updateGain(gain) {
  if (!Number.isFinite(gain)) {
    return;
  }

  state.gain = clampGain(gain);
  render();

  if (activeTabId) {
    state = await sendToServiceWorker({
      type: "SET_GAIN",
      tabId: activeTabId,
      gain: state.gain
    });
    render();
  }
}

function clampGain(gain) {
  return Math.min(5, Math.max(1, gain));
}

function sendToServiceWorker(payload) {
  return chrome.runtime.sendMessage(payload).then((response) => {
    if (response?.error) {
      throw new Error(response.error);
    }

    return response;
  });
}
