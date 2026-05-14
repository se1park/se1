const OFFSCREEN_DOCUMENT = "offscreen.html";
const DEFAULT_GAIN = 2;
const MIN_GAIN = 1;
const MAX_GAIN = 10;
const STORAGE_KEY = "tabBoostStates";

let creatingOffscreenDocument = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        active: false,
        gain: message.gain ?? DEFAULT_GAIN,
        error: error.message
      });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_BOOST", tabId });
  removeStoredState(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadgeForTab(tabId);
});

async function handleMessage(message) {
  if (!message?.type) {
    throw new Error("알 수 없는 요청입니다.");
  }

  if (message.type === "GET_STATE") {
    return getState(message.tabId);
  }

  if (message.type === "START_BOOST") {
    return startBoost(message.tabId, message.gain);
  }

  if (message.type === "STOP_BOOST") {
    return stopBoost(message.tabId);
  }

  if (message.type === "SET_GAIN") {
    return setGain(message.tabId, message.gain);
  }

  if (message.type === "BOOST_STOPPED") {
    await removeStoredState(message.tabId);
    return getState(message.tabId);
  }

  throw new Error("지원하지 않는 요청입니다.");
}

async function startBoost(tabId, gain) {
  assertTabId(tabId);
  const nextGain = normalizeGain(gain);

  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await sendToOffscreen({
    target: "offscreen",
    type: "START_BOOST",
    tabId,
    streamId,
    gain: nextGain
  });

  await setStoredState(tabId, { active: true, gain: nextGain });
  await updateBadge(tabId, true);
  return getState(tabId);
}

async function stopBoost(tabId) {
  assertTabId(tabId);
  await ensureOffscreenDocument();
  await sendToOffscreen({ target: "offscreen", type: "STOP_BOOST", tabId });
  await removeStoredState(tabId);
  await updateBadge(tabId, false);
  return getState(tabId);
}

async function setGain(tabId, gain) {
  assertTabId(tabId);
  const nextGain = normalizeGain(gain);
  const current = await getState(tabId);

  if (current.active) {
    await ensureOffscreenDocument();
    await sendToOffscreen({
      target: "offscreen",
      type: "SET_GAIN",
      tabId,
      gain: nextGain
    });
  }

  await setStoredState(tabId, { active: current.active, gain: nextGain });
  await updateBadge(tabId, current.active);
  return getState(tabId);
}

async function getState(tabId) {
  const states = await getStoredStates();
  const existing = states[String(tabId)];
  return existing ?? { active: false, gain: DEFAULT_GAIN };
}

async function getStoredStates() {
  const result = await chrome.storage.session.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? {};
}

async function setStoredState(tabId, state) {
  const states = await getStoredStates();
  states[String(tabId)] = state;
  await chrome.storage.session.set({ [STORAGE_KEY]: states });
}

async function removeStoredState(tabId) {
  const states = await getStoredStates();
  delete states[String(tabId)];
  await chrome.storage.session.set({ [STORAGE_KEY]: states });
  await updateBadge(tabId, false);
}

async function sendToOffscreen(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || "오디오 처리를 시작하지 못했습니다.");
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT,
      reasons: ["USER_MEDIA"],
      justification: "Process captured tab audio with Web Audio."
    });
  }

  await creatingOffscreenDocument;
  creatingOffscreenDocument = null;
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("대상 탭을 찾을 수 없습니다.");
  }
}

function normalizeGain(gain) {
  const value = Number(gain);

  if (!Number.isFinite(value)) {
    return DEFAULT_GAIN;
  }

  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, value));
}

async function updateBadgeForTab(tabId) {
  const state = await getState(tabId);
  await updateBadge(tabId, state.active);
}

async function updateBadge(tabId, active) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  await chrome.action.setBadgeText({
    tabId,
    text: active ? "ON" : ""
  });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: "#0f766e"
  });
}
