const OFFSCREEN_DOCUMENT = "offscreen.html";
const DEFAULT_GAIN = 2;
const MIN_GAIN = 1;
const MAX_GAIN = 10;
const STORAGE_KEY = "tabBoostStates";

let creatingOffscreenDocument = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        active: false,
        gain: message?.gain ?? DEFAULT_GAIN,
        error: error.message
      });
    });

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanupClosedTab(tabId).catch((error) => console.warn(error));
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadgeForTab(tabId).catch((error) => console.warn(error));
});

async function handleMessage(message) {
  if (!message?.type) {
    throw new Error("Unknown request.");
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
    await removeStoredState(message.tabId, false);
    return getState(message.tabId);
  }

  throw new Error("Unsupported request.");
}

async function cleanupClosedTab(tabId) {
  await stopOffscreenIfPresent(tabId);
  await removeStoredState(tabId, false);
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
  await removeStoredState(tabId, false);
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
  return normalizeStoredState(existing);
}

async function getStoredStates() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const states = result[STORAGE_KEY];

    if (isPlainObject(states)) {
      return states;
    }

    await chrome.storage.session.set({ [STORAGE_KEY]: {} });
  } catch (error) {
    console.warn(error);
  }

  return {};
}

async function setStoredState(tabId, state) {
  const states = await getStoredStates();
  states[String(tabId)] = normalizeStoredState(state);
  await setStoredStates(states);
}

async function removeStoredState(tabId, updateTabBadge = true) {
  const states = await getStoredStates();
  delete states[String(tabId)];
  await setStoredStates(states);

  if (updateTabBadge) {
    await updateBadge(tabId, false);
  }
}

async function setStoredStates(states) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: states });
  } catch (error) {
    console.warn(error);
  }
}

async function sendToOffscreen(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || "Could not start audio processing.");
  }
}

async function stopOffscreenIfPresent(tabId) {
  if (!(await hasOffscreenDocument())) {
    return;
  }

  try {
    await sendToOffscreen({ target: "offscreen", type: "STOP_BOOST", tabId });
  } catch (error) {
    console.warn(error);
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
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

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  return contexts.length > 0;
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Could not find the target tab.");
  }
}

function normalizeGain(gain) {
  const value = Number(gain);

  if (!Number.isFinite(value)) {
    return DEFAULT_GAIN;
  }

  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, value));
}

function normalizeStoredState(state) {
  if (!isPlainObject(state)) {
    return { active: false, gain: DEFAULT_GAIN };
  }

  return {
    active: state.active === true,
    gain: normalizeGain(state.gain)
  };
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function updateBadgeForTab(tabId) {
  const state = await getState(tabId);
  await updateBadge(tabId, state.active);
}

async function updateBadge(tabId, active) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  if (!(await tabExists(tabId))) {
    return;
  }

  try {
    await chrome.action.setBadgeText({
      tabId,
      text: active ? "ON" : ""
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: "#0f766e"
    });
  } catch (error) {
    if (!isMissingTabError(error)) {
      console.warn(error);
    }
  }
}

async function tabExists(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (error) {
    if (!isMissingTabError(error)) {
      console.warn(error);
    }

    return false;
  }
}

function isMissingTabError(error) {
  return error?.message?.startsWith("No tab with id:");
}
