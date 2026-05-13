const sessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }

  handleMessage(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleMessage(message) {
  if (message.type === "START_BOOST") {
    await startBoost(message.tabId, message.streamId, message.gain);
    return;
  }

  if (message.type === "STOP_BOOST") {
    stopBoost(message.tabId);
    return;
  }

  if (message.type === "SET_GAIN") {
    setGain(message.tabId, message.gain);
  }
}

async function startBoost(tabId, streamId, gain) {
  stopBoost(tabId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();

  gainNode.gain.value = gain;
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  stream.getAudioTracks().forEach((track) => {
    track.addEventListener("ended", () => {
      stopBoost(tabId);
      chrome.runtime.sendMessage({ type: "BOOST_STOPPED", tabId });
    });
  });

  sessions.set(tabId, { audioContext, gainNode, stream });
}

function stopBoost(tabId) {
  const session = sessions.get(tabId);

  if (!session) {
    return;
  }

  session.stream.getTracks().forEach((track) => track.stop());
  session.audioContext.close();
  sessions.delete(tabId);
}

function setGain(tabId, gain) {
  const session = sessions.get(tabId);

  if (session) {
    session.gainNode.gain.value = gain;
  }
}
