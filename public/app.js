const roleDetails = {
  listener: { label: "Słuchacz", team: null, general: false },
  supple: { label: "Supple", team: "supple", general: false },
  support: { label: "Support", team: "support", general: false },
  szturm: { label: "Szturm", team: "szturm", general: false },
  "general-supple": { label: "Generał Supple", team: "supple", general: true },
  "general-support": { label: "Generał Support", team: "support", general: true },
  "general-szturm": { label: "Generał Szturm", team: "szturm", general: true },
};
const avatarIcons = {
  listener: "/icons/listener.svg",
  supple: "/icons/supple.svg",
  support: "/icons/support.svg",
  szturm: "/icons/szturm.svg",
};

const joinScreen = document.querySelector("#join-screen");
const roomScreen = document.querySelector("#room-screen");
const startActions = document.querySelector("#start-actions");
const createRoomButton = document.querySelector("#create-room");
const showJoinFormButton = document.querySelector("#show-join-form");
const startError = document.querySelector("#start-error");
const accessForm = document.querySelector("#access-form");
const accessError = document.querySelector("#access-error");
const roomCodeInput = document.querySelector("#room-code");
const resumeRoomButton = document.querySelector("#resume-room");
const nicknameInput = document.querySelector("#nickname");
const inviteCard = document.querySelector("#invite-card");
const inviteCode = document.querySelector("#invite-code");
const copyStatus = document.querySelector("#copy-status");
const peopleList = document.querySelector("#people-list");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatMessages = document.querySelector("#chat-messages");
const chatSendButton = document.querySelector("#chat-send");
const participantCount = document.querySelector("#participant-count");
const peopleTotal = document.querySelector("#people-total");
const voiceStatus = document.querySelector("#voice-status");
const micToggle = document.querySelector("#mic-toggle");
const muteAllToggle = document.querySelector("#mute-all-toggle");
const volumeToggle = document.querySelector("#volume-toggle");
const volumeControl = document.querySelector("#volume-control");
const remoteVolume = document.querySelector("#remote-volume");
const remoteVolumeValue = document.querySelector("#remote-volume-value");
const micLabel = document.querySelector("#mic-label");
const micHint = document.querySelector("#mic-hint");
const selfName = document.querySelector("#self-name");
const selfAvatar = document.querySelector("#self-avatar");
const connectionPill = document.querySelector("#connection-pill");
const micMonitor = document.querySelector("#mic-monitor");
const micTestToggle = document.querySelector("#mic-test-toggle");
const micBar = document.querySelector(".mic-bar");
const pushToTalkButton = document.querySelector("#push-to-talk");
const pushToTalkKeyButton = document.querySelector("#push-to-talk-key");
const pushToTalkSpeakers = document.querySelector("#ptt-speakers");
const networkWarning = document.querySelector("#network-warning");
const roomLabel = document.querySelector("#room-label");
const toast = document.querySelector("#toast");
const logoutButton = document.querySelector("#logout-button");

let socket;
let selfId;
let nickname;
let roomCode;
let isRoomCreator = false;
let selectedRole = "listener";
let microphoneStream;
let microphoneTrack;
let microphoneAcquiring = false;
let microphoneEnabled = false;
let microphoneTestEnabled = false;
let microphoneWasEnabledBeforeTest = false;
let allMuted = false;
let microphoneEnabledBeforeAllMute = false;
let pushToTalkActive = false;
let pushToTalkKey;
let pushToTalkKeyLabel = "";
let isBindingPushToTalkKey = false;
let iceServers;
let toastTimeout;
const remoteAudioElements = new Map();
const users = new Map();
const peers = new Map();
let lastChatSentAt = 0;

function roleFor(user) {
  return roleDetails[user?.role] || roleDetails.listener;
}

function setRoleAvatar(avatar, role) {
  const details = roleDetails[role] || roleDetails.listener;
  const icon = details.team || "listener";
  avatar.classList.toggle("avatar-listener", icon === "listener");
  avatar.classList.toggle("avatar-supple", icon === "supple");
  avatar.classList.toggle("avatar-support", icon === "support");
  avatar.classList.toggle("avatar-szturm", icon === "szturm");

  const image = document.createElement("img");
  image.src = avatarIcons[icon];
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  avatar.replaceChildren(image);
}

function canSpeak(speaker, receiver) {
  const speakerRole = roleDetails[speaker?.role];
  const receiverRole = roleDetails[receiver?.role];
  if (!speakerRole || !receiverRole || speakerRole.team === null) {
    return false;
  }
  if (receiverRole.team === null) {
    return receiverRole.label === "Słuchacz";
  }
  return speakerRole.team === receiverRole.team
    || speakerRole.general && receiverRole.general;
}

function canHear(receiver, speaker) {
  return canSpeak(speaker, receiver);
}

function shouldConnectAudio(firstUser, secondUser) {
  return Boolean(firstUser && secondUser);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 5000);
}

function setConnectionState(connected, message) {
  connectionPill.classList.toggle("is-offline", !connected);
  connectionPill.lastElementChild.textContent = message;
}

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

function updateVoiceStatus() {
  const role = roleFor({ role: selectedRole });
  const roleName = role.label;
  const roleCanSpeak = selectedRole !== "listener";
  const isTransmitting = (microphoneEnabled || pushToTalkActive) && roleCanSpeak && !allMuted;
  const listenText = "Słuchasz wszystkich";
  const talkText = allMuted
    ? "Mikrofon i dźwięk od innych osób są wyciszone."
    : microphoneTestEnabled
    ? "Słyszysz swój mikrofon lokalnie; Twój głos nie jest wysyłany."
    : !roleCanSpeak
      ? "Rola Słuchacz nie nadaje dźwięku."
    : pushToTalkActive
      ? "Nadajesz do wszystkich uczestników przez kanał globalny."
    : isTransmitting
      ? `Nadajesz jako ${roleName}`
      : "Włącz mikrofon, aby mówić w swojej drużynie.";

  voiceStatus.querySelector("strong").textContent = allMuted
    ? "Wszystko wyciszone"
    : microphoneTestEnabled
    ? "Test mikrofonu"
    : !roleCanSpeak
      ? "Tryb słuchania"
    : pushToTalkActive
      ? "Nadajesz globalnie"
    : isTransmitting
      ? `Nadajesz: ${roleName}`
      : listenText;
  voiceStatus.querySelector("small").textContent = talkText;
  voiceStatus.querySelector(".banner-state").textContent = allMuted
    ? "WYCISZONE"
    : microphoneTestEnabled
    ? "TEST"
    : isTransmitting
      ? "NA ŻYWO"
      : "NASŁUCH";
  voiceStatus.classList.toggle("is-talking", isTransmitting && !microphoneTestEnabled);
  voiceStatus.classList.toggle("is-muted", !isTransmitting || microphoneTestEnabled);
  micBar.classList.toggle("is-testing", microphoneTestEnabled);
  micToggle.disabled = microphoneTestEnabled || !roleCanSpeak;
  micToggle.classList.toggle("is-on", microphoneEnabled && roleCanSpeak);
  micToggle.querySelector("span:last-child").textContent = microphoneEnabled ? "Wycisz mikrofon" : "Włącz mikrofon";
  muteAllToggle.disabled = microphoneTestEnabled;
  muteAllToggle.setAttribute("aria-pressed", String(allMuted));
  muteAllToggle.classList.toggle("is-on", allMuted);
  muteAllToggle.querySelector("span:last-child").textContent = allMuted ? "Włącz wszystko" : "Wycisz wszystko";
  micTestToggle.disabled = !microphoneTrack || allMuted;
  micTestToggle.classList.toggle("is-active", microphoneTestEnabled);
  micTestToggle.querySelector("span:last-child").textContent = microphoneTestEnabled ? "Zakończ test" : "Sprawdź mikrofon";
  micLabel.textContent = allMuted
    ? "Wszystko wyciszone"
    : microphoneTestEnabled
    ? "Test mikrofonu w toku"
    : !roleCanSpeak
      ? "Tryb Słuchacz nie wysyła dźwięku"
    : pushToTalkActive
      ? "Mikrofon nadaje globalnie"
    : isTransmitting
      ? "Mikrofon włączony"
      : "Mikrofon wyłączony";
  micHint.textContent = allMuted
    ? "Mikrofon i dźwięk od innych osób są wyłączone"
    : microphoneTestEnabled
    ? "Słuchasz siebie lokalnie; nadal możesz słyszeć innych"
    : !roleCanSpeak
        ? "Słyszysz wszystkie drużyny, ale nie możesz nadawać"
    : pushToTalkActive
      ? "Mówisz do wszystkich, dopóki przytrzymujesz klawisz"
    : isTransmitting
        ? role.general
          ? "Nadajesz do swojej drużyny i wszystkich generałów"
          : "Nadajesz do swojej drużyny i jej generała"
        : "Włącz mikrofon, aby mówić w swojej drużynie";
  pushToTalkButton.disabled = !roleCanSpeak || !microphoneTrack || allMuted || microphoneTestEnabled;
  pushToTalkButton.classList.toggle("is-active", pushToTalkActive);
  pushToTalkButton.setAttribute("aria-pressed", String(pushToTalkActive));
  pushToTalkKeyButton.disabled = !roleCanSpeak;
  pushToTalkKeyButton.classList.toggle("is-binding", isBindingPushToTalkKey);
  pushToTalkKeyButton.textContent = isBindingPushToTalkKey
    ? "Naciśnij dowolny klawisz..."
    : pushToTalkKeyLabel
      ? `Klawisz: ${pushToTalkKeyLabel}`
      : "Ustaw klawisz";
}

function updateRoleButtons() {
  document.querySelectorAll(".role-card").forEach((button) => {
    const isSelected = button.dataset.role === selectedRole;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function createPersonRow(person) {
  const row = document.createElement("div");
  row.className = `person${person.id === selfId ? " is-self" : ""}`;

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  setRoleAvatar(avatar, person.role);

  const info = document.createElement("span");
  info.className = "person-info";
  const name = document.createElement("span");
  name.className = "person-name";
  name.textContent = person.nickname;
  const role = document.createElement("span");
  role.className = "person-role";
  role.textContent = roleFor(person).label;
  const audioStatus = document.createElement("span");
  audioStatus.className = "person-audio-status";

  let statusText;
  let isSendingAudio = false;
  if (person.id === selfId) {
    const sentPackets = [...peers.values()]
      .reduce((total, peer) => total + peer.sentAudioPackets, 0);
    const senderTrackMissing = [...peers.values()]
      .some((peer) => peer.sender.track?.readyState !== "live");
    isSendingAudio = microphoneEnabled && !microphoneTestEnabled && sentPackets > 0;
    statusText = microphoneTestEnabled
      ? "Test lokalny, nie wysyła"
      : !microphoneEnabled
        ? "Mikrofon wyłączony"
        : peers.size === 0
          ? "Mikrofon włączony; brak innych osób"
          : sentPackets > 0
            ? "Wysyłam pakiety audio"
            : senderTrackMissing
              ? "Mikrofon niepodłączony do WebRTC"
              : "Mikrofon podłączony; brak pakietów — mów głośno";
  } else {
    const peer = peers.get(person.id);
    statusText = !peer
      ? "Brak połączenia audio"
      : peer.connection.connectionState === "failed"
        ? "Połączenie audio nieudane"
        : peer.receivedAudioPackets > 0
          ? remoteAudioElements.get(person.id)?.paused
            ? "Odebrano audio; kliknij Głośność, aby odtworzyć"
            : "Odbieram i odtwarzam audio"
        : peer.stream?.getAudioTracks().some((track) => track.muted)
          ? "Połączenie jest, ale mikrofon drugiej osoby jest wyciszony"
          : peer.connection.connectionState === "connected"
            ? "Połączono; brak pakietów audio"
            : `Łączenie audio: ${peer.connection.iceConnectionState}`;
    isSendingAudio = peer?.receivedAudioPackets > 0;
  }

  audioStatus.textContent = statusText;
  info.append(name, role, audioStatus);

  const state = document.createElement("span");
  state.className = `person-state${isSendingAudio ? " is-talking" : ""}`;
  state.textContent = isSendingAudio ? "●" : "◌";
  state.setAttribute("aria-label", statusText);
  row.append(avatar, info, state);
  return row;
}

function renderPeople() {
  const people = [...users.values()];

  participantCount.textContent = `${people.length} ${people.length === 1 ? "osoba" : people.length < 5 ? "osoby" : "osób"}`;
  peopleTotal.textContent = String(people.length);
  peopleList.replaceChildren();

  if (people.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-people";
    empty.textContent = "Nikogo tu jeszcze nie ma. Zaproś znajomych do pokoju.";
    peopleList.append(empty);
    return;
  }

  function appendGroup(title, members) {
    if (members.length === 0) {
      return;
    }

    const group = document.createElement("section");
    group.className = "people-group";
    const heading = document.createElement("div");
    heading.className = "people-group-heading";
    const name = document.createElement("span");
    name.textContent = title;
    const count = document.createElement("span");
    count.textContent = String(members.length);
    heading.append(name, count);
    group.append(heading);

    members.sort((a, b) => Number(roleFor(b).general) - Number(roleFor(a).general));
    for (const person of members) {
      group.append(createPersonRow(person));
    }
    peopleList.append(group);
  }

  appendGroup("Supple", people.filter((person) => roleFor(person).team === "supple"));
  appendGroup("Support", people.filter((person) => roleFor(person).team === "support"));
  appendGroup("Szturm", people.filter((person) => roleFor(person).team === "szturm"));
  appendGroup("Słuchacze", people.filter((person) => roleFor(person).team === null));
}

function renderPushToTalkSpeakers() {
  const speakers = [...users.values()]
    .filter((user) => user.pushToTalkActive && user.role !== "listener");
  pushToTalkSpeakers.replaceChildren();

  if (speakers.length === 0) {
    const row = document.createElement("tr");
    row.className = "ptt-empty";
    const empty = document.createElement("td");
    empty.colSpan = 2;
    empty.textContent = "Nikt teraz nie mówi.";
    row.append(empty);
    pushToTalkSpeakers.append(row);
    return;
  }

  for (const speaker of speakers) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = speaker.nickname;
    const status = document.createElement("td");
    status.className = "ptt-speaking";
    status.textContent = "● Mówi";
    row.append(name, status);
    pushToTalkSpeakers.append(row);
  }
}

function syncAudioElements() {
  const activeStreams = new Map([...users.values()]
    .filter((user) => user.id !== selfId && (
      canHear({ role: selectedRole }, user) || user.pushToTalkActive
    ))
    .flatMap((user) => {
      const stream = peers.get(user.id)?.stream;
      return stream?.getAudioTracks().some((track) => track.readyState === "live")
        ? [[user.id, stream]]
        : [];
    }));

  for (const [id, audio] of remoteAudioElements) {
    if (!activeStreams.has(id)) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      remoteAudioElements.delete(id);
    }
  }

  for (const [id, stream] of activeStreams) {
    let audio = remoteAudioElements.get(id);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.peerId = id;
      audio.addEventListener("playing", renderPeople);
      audio.addEventListener("pause", renderPeople);
      audio.srcObject = stream;
      document.body.append(audio);
      remoteAudioElements.set(id, audio);
    } else if (audio.srcObject !== stream) {
      audio.srcObject = stream;
    }

    audio.muted = allMuted;
    audio.volume = Number(remoteVolume.value) / 100;
    if (audio.paused) {
      void audio.play().catch(() => {
        showToast("Odtwarzanie jest zablokowane. Kliknij przycisk Głośność, aby włączyć dźwięk.");
      });
    }
  }
}

function applyRemoteVolume() {
  for (const audio of remoteAudioElements.values()) {
    audio.muted = allMuted;
    audio.volume = Number(remoteVolume.value) / 100;
  }
}

roomScreen.addEventListener("pointerdown", () => {
  syncAudioElements();
});

async function syncPeerSender(peer) {
  const user = users.get(peer.id);
  if (!user || !peer.sender) {
    return false;
  }

  const canSendGlobal = pushToTalkActive && selectedRole !== "listener";
  const canSendOnRoleChannel = microphoneEnabled && canSpeak({ role: selectedRole }, user);
  const desiredTrack = microphoneTrack
    && !allMuted
    && !microphoneTestEnabled
    && (canSendGlobal || canSendOnRoleChannel)
    ? microphoneTrack
    : null;
  peer.desiredTrack = desiredTrack;
  if (peer.senderUpdate) {
    return peer.senderUpdate;
  }
  if (peer.currentTrack === peer.desiredTrack) {
    return true;
  }

  peer.senderUpdate = (async () => {
    try {
      while (peer.currentTrack !== peer.desiredTrack) {
        const nextTrack = peer.desiredTrack;
        await peer.sender.replaceTrack(nextTrack);
        peer.currentTrack = nextTrack;
      }
      renderPeople();
      return true;
    } catch (error) {
      showToast(`Nie udało się zmienić nadawania audio: ${error.message}`);
      return false;
    } finally {
      peer.senderUpdate = null;
    }
  })();
  return peer.senderUpdate;
}

function syncPeerMedia() {
  for (const peer of peers.values()) {
    void syncPeerSender(peer);
  }
  syncAudioElements();
}

function setPushToTalk(active) {
  const canUsePushToTalk = selectedRole !== "listener"
    && Boolean(microphoneTrack)
    && !allMuted
    && !microphoneTestEnabled;
  if (active && (!canUsePushToTalk || pushToTalkActive)) {
    return;
  }
  if (!active && !pushToTalkActive) {
    return;
  }

  if (active && !send({ type: "push-to-talk", active: true })) {
    showToast("Nie można nadawać bez połączenia z pokojem.");
    return;
  }
  if (!active) {
    send({ type: "push-to-talk", active: false });
  }

  pushToTalkActive = active;
  if (microphoneTrack) {
    microphoneTrack.enabled = active || microphoneEnabled;
  }
  if (selfId && users.has(selfId)) {
    users.get(selfId).pushToTalkActive = active;
  }
  updateVoiceStatus();
  renderPushToTalkSpeakers();
  syncPeerMedia();
}

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function describeKey(event) {
  if (event.key === " ") {
    return "Spacja";
  }
  return event.key.length === 1 ? event.key.toLocaleUpperCase("pl-PL") : event.key;
}

function handlePushToTalkKeyDown(event) {
  if (isBindingPushToTalkKey) {
    if (selectedRole === "listener") {
      isBindingPushToTalkKey = false;
      updateVoiceStatus();
      return;
    }
    if (event.key === "Escape") {
      isBindingPushToTalkKey = false;
      updateVoiceStatus();
      return;
    }
    if (
      event.ctrlKey
      || event.altKey
      || event.metaKey
      || isEditableTarget(event.target)
      || event.code === "Unidentified"
    ) {
      return;
    }

    pushToTalkKey = event.code;
    pushToTalkKeyLabel = describeKey(event);
    isBindingPushToTalkKey = false;
    event.preventDefault();
    updateVoiceStatus();
    return;
  }

  if (
    pushToTalkKey
    && event.code === pushToTalkKey
    && !event.repeat
    && !event.ctrlKey
    && !event.altKey
    && !event.metaKey
    && !isEditableTarget(event.target)
  ) {
    event.preventDefault();
    setPushToTalk(true);
  }
}

function handlePushToTalkKeyUp(event) {
  if (pushToTalkKey && event.code === pushToTalkKey) {
    setPushToTalk(false);
  }
}

function toggleMicrophoneTest() {
  if (!microphoneTrack || allMuted) {
    return;
  }

  microphoneTestEnabled = !microphoneTestEnabled;
  if (microphoneTestEnabled) {
    setPushToTalk(false);
    microphoneWasEnabledBeforeTest = microphoneEnabled;
    microphoneTrack.enabled = true;
    micMonitor.srcObject = microphoneStream;
    micMonitor.play().catch(() => {
      showToast("Nie można odtworzyć testowego dźwięku. Sprawdź ustawienia dźwięku przeglądarki.");
    });
  } else {
    microphoneTrack.enabled = microphoneEnabled;
    micMonitor.pause();
    micMonitor.srcObject = null;
    microphoneEnabled = microphoneWasEnabledBeforeTest;
  }

  updateVoiceStatus();
  renderPeople();
  syncPeerMedia();
}

function signalPeer(peer, signalType, data) {
  if (!send({ type: "signal", target: peer.id, signalType, data })) {
    showToast("Utracono połączenie z serwerem. Spróbuj ponownie.");
  }
}

function createPeer(user) {
  const connection = new RTCPeerConnection({
    iceServers,
  });
  const audioTransceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
  const peer = {
    id: user.id,
    connection,
    sender: audioTransceiver.sender,
    currentTrack: null,
    desiredTrack: null,
    senderUpdate: null,
    stream: null,
    pendingCandidates: [],
    receivedAudioPackets: 0,
    sentAudioPackets: 0,
    statsErrorShown: false,
  };
  peers.set(user.id, peer);

  peer.statsTimer = window.setInterval(() => {
    void updatePeerStats(peer);
  }, 2000);

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      signalPeer(peer, "ice", event.candidate);
    }
  };
  connection.ontrack = (event) => {
    peer.stream = event.streams[0] || new MediaStream([event.track]);
    for (const eventName of ["ended", "mute", "unmute"]) {
      event.track.addEventListener(eventName, () => {
        syncAudioElements();
        renderPeople();
      });
    }
    syncAudioElements();
  };
  connection.onconnectionstatechange = () => {
    renderPeople();
    if (connection.connectionState === "failed") {
      showToast(`Nie można połączyć się audio z ${users.get(peer.id)?.nickname || "uczestnikiem"}. Sprawdź, czy serwer TURN jest skonfigurowany.`);
    }
  };

  void syncPeerSender(peer);
  if (selfId.localeCompare(user.id) < 0) {
    void createOffer(peer);
  }
  return peer;
}

function reconcilePeers() {
  const localUser = users.has(selfId)
    ? { ...users.get(selfId), role: selectedRole }
    : undefined;
  for (const [id, peer] of peers) {
    const remoteUser = users.get(id);
    if (!remoteUser || !localUser || !shouldConnectAudio(localUser, remoteUser)) {
      window.clearInterval(peer.statsTimer);
      peer.connection.close();
      peers.delete(id);
    }
  }

  for (const user of users.values()) {
    if (
      user.id !== selfId
      && localUser
      && shouldConnectAudio(localUser, user)
      && !peers.has(user.id)
    ) {
      createPeer(user);
    }
  }
  syncPeerMedia();
}

async function updatePeerStats(peer) {
  if (peer.connection.connectionState === "closed") {
    return;
  }

  try {
    const reports = await peer.connection.getStats();
    const previousReceived = peer.receivedAudioPackets;
    const previousSent = peer.sentAudioPackets;
    peer.receivedAudioPackets = 0;
    peer.sentAudioPackets = 0;

    for (const report of reports.values()) {
      const isAudio = report.kind === "audio" || report.mediaType === "audio";
      if (!isAudio) {
        continue;
      }
      if (report.type === "inbound-rtp" && !report.isRemote) {
        peer.receivedAudioPackets = report.packetsReceived || 0;
      } else if (report.type === "outbound-rtp" && !report.isRemote) {
        peer.sentAudioPackets = report.packetsSent || 0;
      }
    }

    if (
      (previousReceived === 0) !== (peer.receivedAudioPackets === 0)
      || (previousSent === 0) !== (peer.sentAudioPackets === 0)
    ) {
      renderPeople();
    }
  } catch (error) {
    if (!peer.statsErrorShown) {
      peer.statsErrorShown = true;
      showToast(`Nie można sprawdzić stanu audio z ${users.get(peer.id)?.nickname || "uczestnikiem"}: ${error.message}`);
    }
  }
}

async function createOffer(peer) {
  try {
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    signalPeer(peer, "offer", peer.connection.localDescription);
  } catch (error) {
    showToast(`Nie udało się rozpocząć połączenia audio: ${error.message}`);
  }
}

async function handleSignal(message) {
  const user = users.get(message.from);
  const localUser = users.get(selfId);
  if (
    !user
    || !localUser
    || !shouldConnectAudio({ ...localUser, role: selectedRole }, user)
  ) {
    return;
  }

  const peer = peers.get(message.from) || createPeer(user);
  try {
    if (message.signalType === "offer") {
      await peer.connection.setRemoteDescription(message.data);
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate);
      }
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      signalPeer(peer, "answer", peer.connection.localDescription);
      return;
    }

    if (message.signalType === "answer") {
      await peer.connection.setRemoteDescription(message.data);
      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate);
      }
      return;
    }

    if (message.signalType === "ice") {
      if (peer.connection.remoteDescription) {
        await peer.connection.addIceCandidate(message.data);
      } else {
        peer.pendingCandidates.push(message.data);
      }
    }
  } catch (error) {
    showToast(`Błąd połączenia audio: ${error.message}`);
  }
}

function handleRoster(roster) {
  users.clear();
  for (const user of roster) {
    users.set(user.id, user);
  }

  if (selfId && users.has(selfId)) {
    nickname = users.get(selfId).nickname;
    selfName.textContent = nickname;
    setRoleAvatar(selfAvatar, users.get(selfId).role);
  }

  renderPeople();
  renderPushToTalkSpeakers();
  reconcilePeers();
}

function renderChatMessage(message) {
  const row = document.createElement("p");
  row.className = "chat-message";
  const team = document.createElement("strong");
  team.className = "chat-team";
  team.textContent = `${message.team}:`;
  const name = document.createElement("strong");
  name.className = "chat-nickname";
  name.textContent = `(${message.nickname})`;
  const text = document.createElement("span");
  text.className = "chat-text";
  text.textContent = message.text;
  row.append(team, name, text);
  chatMessages.append(row);

  while (chatMessages.childElementCount > 100) {
    chatMessages.firstElementChild.remove();
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showChatHistory(messages) {
  chatMessages.replaceChildren();
  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "Wiadomości z pokoju pojawią się tutaj.";
    chatMessages.append(empty);
    return;
  }
  for (const message of messages) {
    renderChatMessage(message);
  }
}

function setRole(role) {
  if (!roleDetails[role]) {
    return;
  }

  if (pushToTalkActive || role === "listener") {
    setPushToTalk(false);
  }
  if (role === "listener") {
    isBindingPushToTalkKey = false;
  }
  selectedRole = role;
  if (role === "listener") {
    microphoneEnabled = false;
    if (microphoneTrack) {
      microphoneTrack.enabled = false;
    }
  }
  setRoleAvatar(selfAvatar, role);
  updateRoleButtons();
  updateVoiceStatus();
  send({ type: "role", role });
  if (selfId && users.has(selfId)) {
    reconcilePeers();
  } else {
    syncPeerMedia();
  }

  if (role !== "listener" && !microphoneTrack && !microphoneAcquiring) {
    microphoneAcquiring = true;
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    .then(async (stream) => {
      microphoneStream = stream;
      microphoneTrack = stream.getAudioTracks()[0];
      if (!microphoneTrack) {
        throw new Error("Przeglądarka nie udostępniła ścieżki audio z mikrofonu.");
      }
      microphoneTrack.addEventListener("ended", () => {
        setPushToTalk(false);
        microphoneEnabled = false;
        updateVoiceStatus();
        renderPeople();
        syncPeerMedia();
        showToast("Mikrofon został odłączony. Włącz go ponownie.");
      }, { once: true });
      microphoneEnabled = !allMuted && selectedRole !== "listener";
      microphoneTrack.enabled = microphoneEnabled;
      const senderResults = await Promise.all([...peers.values()].map(syncPeerSender));
      if (microphoneEnabled && senderResults.some((attached) => !attached)) {
        microphoneEnabled = false;
        microphoneTrack.enabled = false;
        throw new Error("Mikrofon nie został podłączony do wszystkich połączeń audio.");
      }
      updateVoiceStatus();
      renderPeople();
    })
    .catch((error) => {
      microphoneStream?.getTracks().forEach((track) => track.stop());
      microphoneStream = undefined;
      microphoneTrack = undefined;
      microphoneEnabled = false;
      updateVoiceStatus();
      showToast(`Nie można włączyć mikrofonu: ${error.message}. Sprawdź uprawnienia przeglądarki.`);
    })
    .finally(() => {
      microphoneAcquiring = false;
    });
    return;
  }

  updateVoiceStatus();
  renderPeople();
  syncPeerMedia();
}

function leaveRoom() {
  setPushToTalk(false);
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }
  for (const peer of peers.values()) {
    window.clearInterval(peer.statsTimer);
    peer.connection.close();
  }
  peers.clear();
  users.clear();
  showChatHistory([]);
  lastChatSentAt = 0;
  if (microphoneStream) {
    microphoneStream.getTracks().forEach((track) => track.stop());
  }
  micMonitor.srcObject = null;
  microphoneStream = undefined;
  microphoneTrack = undefined;
  microphoneEnabled = false;
  pushToTalkActive = false;
  isBindingPushToTalkKey = false;
  allMuted = false;
  microphoneEnabledBeforeAllMute = false;
  microphoneTestEnabled = false;
  microphoneWasEnabledBeforeTest = false;
  selfId = undefined;
  selectedRole = "listener";
  roomCode = undefined;
  isRoomCreator = false;
  inviteCard.classList.add("is-hidden");
  for (const audio of remoteAudioElements.values()) {
    audio.pause();
    audio.srcObject = null;
    audio.remove();
  }
  remoteAudioElements.clear();
  updateRoleButtons();
  updateVoiceStatus();
  joinScreen.classList.remove("is-hidden");
  roomScreen.classList.add("is-hidden");
}

async function initializeAccess() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const session = await response.json();
    const authenticated = session.authenticated === true;
    roomCode = authenticated ? session.roomCode : undefined;
    isRoomCreator = authenticated && session.isCreator === true;
    startActions.classList.remove("is-hidden");
    accessForm.classList.add("is-hidden");
    resumeRoomButton.classList.toggle("is-hidden", !authenticated);
    if (authenticated) {
      resumeRoomButton.querySelector("span:first-child").textContent = `Wróć do pokoju ${roomCode}`;
    }
    logoutButton.classList.add("is-hidden");
    if (authenticated) {
      accessError.textContent = "";
      roomCodeInput.value = "";
    }
  } catch (error) {
    startActions.classList.remove("is-hidden");
    accessForm.classList.add("is-hidden");
    startError.textContent = `Nie udało się sprawdzić dostępu do pokoju: ${error.message}`;
  }
}

function readNickname(errorElement = startError) {
  const value = nicknameInput.value.trim().slice(0, 24);
  if (!value) {
    errorElement.textContent = "Wpisz swój nick, zanim wybierzesz pokój.";
    nicknameInput.focus();
    return undefined;
  }
  nickname = value;
  errorElement.textContent = "";
  return nickname;
}

async function createRoom() {
  if (!readNickname()) {
    return;
  }
  createRoomButton.disabled = true;
  startError.textContent = "";
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    roomCode = result.roomCode;
    isRoomCreator = true;
    await initializeAccess();
    await connectToRoom(nickname);
  } catch (error) {
    startError.textContent = `Nie udało się utworzyć pokoju: ${error.message}`;
  } finally {
    createRoomButton.disabled = false;
  }
}

async function connectToRoom(name, errorElement = startError) {
  nickname = name;
  startError.textContent = "";
  errorElement.textContent = "";
  try {
    const response = await fetch("/api/ice-config", { cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        "Serwer nie obsługuje jeszcze konfiguracji audio. Zaktualizuj i uruchom ponownie backend aplikacji."
      );
    }
    const configuration = await response.json();
    if (!response.ok) {
      throw new Error(configuration.error || `HTTP ${response.status}`);
    }
    if (!Array.isArray(configuration.iceServers) || configuration.iceServers.length === 0) {
      throw new Error("Serwer nie zwrócił konfiguracji ICE.");
    }
    iceServers = configuration.iceServers;
    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => typeof url === "string" && /^turns?:/i.test(url));
    });
    networkWarning.classList.toggle("is-hidden", hasTurn);
  } catch (error) {
    errorElement.textContent = `Nie udało się pobrać konfiguracji audio: ${error.message}`;
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener("open", () => {
    send({ type: "join", nickname });
    setConnectionState(true, "Połączono z pokojem");
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      showToast("Otrzymano nieprawidłową odpowiedź serwera.");
      return;
    }

    if (message.type === "welcome") {
      selfId = message.id;
      joinScreen.classList.add("is-hidden");
      roomScreen.classList.remove("is-hidden");
      chatInput.disabled = false;
      chatSendButton.disabled = false;
      logoutButton.classList.remove("is-hidden");
      selfName.textContent = nickname;
      setRoleAvatar(selfAvatar, selectedRole);
      roomLabel.textContent = `POKÓJ ${roomCode}`;
      inviteCode.textContent = roomCode || "";
      inviteCard.classList.toggle("is-hidden", !isRoomCreator);
      updateVoiceStatus();
      return;
    }
    if (message.type === "roster") {
      handleRoster(message.users);
      return;
    }
    if (message.type === "chat-history") {
      showChatHistory(message.messages);
      return;
    }
    if (message.type === "chat-message") {
      chatMessages.querySelector(".chat-empty")?.remove();
      renderChatMessage(message.message);
      return;
    }
    if (message.type === "signal") {
      void handleSignal(message);
      return;
    }
    if (message.type === "error") {
      if (roomScreen.classList.contains("is-hidden")) {
        startError.textContent = message.message;
      } else {
        showToast(message.message);
      }
    }
  });
  socket.addEventListener("close", () => {
    setPushToTalk(false);
    chatInput.disabled = true;
    chatSendButton.disabled = true;
    setConnectionState(false, "Połączenie przerwane");
    if (!roomScreen.classList.contains("is-hidden")) {
      showToast("Połączenie z pokojem zostało przerwane. Odśwież stronę, aby dołączyć ponownie.");
    }
  });
  socket.addEventListener("error", () => {
    startError.textContent = "Nie udało się połączyć z pokojem. Sprawdź, czy serwer działa.";
  });
}

nicknameInput.addEventListener("input", () => {
  startError.textContent = "";
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }

  if (Date.now() - lastChatSentAt < 750) {
    showToast("Odczekaj chwilę przed wysłaniem kolejnej wiadomości.");
    return;
  }
  if (!send({ type: "chat", text })) {
    showToast("Nie można wysłać wiadomości bez połączenia z pokojem.");
    return;
  }

  lastChatSentAt = Date.now();
  chatInput.value = "";
});

resumeRoomButton.addEventListener("click", () => {
  if (readNickname()) {
    void connectToRoom(nickname);
  }
});

showJoinFormButton.addEventListener("click", () => {
  if (!readNickname()) {
    return;
  }
  startActions.classList.add("is-hidden");
  accessForm.classList.remove("is-hidden");
  accessError.textContent = "";
  roomCodeInput.focus();
});

createRoomButton.addEventListener("click", () => {
  void createRoom();
});

document.querySelector("#back-to-start").addEventListener("click", () => {
  accessForm.classList.add("is-hidden");
  startActions.classList.remove("is-hidden");
  accessError.textContent = "";
});

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessError.textContent = "";
  const submitButton = accessForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    const response = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ code: roomCodeInput.value }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    roomCode = result.roomCode;
    isRoomCreator = false;
    await initializeAccess();
    await connectToRoom(nickname);
  } catch (error) {
    accessError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelectorAll(".role-card").forEach((button) => {
  button.addEventListener("click", () => setRole(button.dataset.role));
});

micToggle.addEventListener("click", () => {
  if (microphoneTestEnabled) {
    return;
  }
  if (!microphoneTrack) {
    setRole(selectedRole);
    return;
  }
  microphoneEnabled = !microphoneEnabled;
  microphoneTrack.enabled = microphoneEnabled;
  updateVoiceStatus();
  renderPeople();
  syncPeerMedia();
});

muteAllToggle.addEventListener("click", () => {
  if (microphoneTestEnabled) {
    return;
  }

  if (!allMuted) {
    setPushToTalk(false);
  }
  allMuted = !allMuted;
  if (allMuted) {
    microphoneEnabledBeforeAllMute = microphoneEnabled;
    microphoneEnabled = false;
    if (microphoneTrack) {
      microphoneTrack.enabled = false;
    }
  } else {
    microphoneEnabled = microphoneEnabledBeforeAllMute
      && Boolean(microphoneTrack);
    microphoneEnabledBeforeAllMute = false;
    if (microphoneTrack) {
      microphoneTrack.enabled = microphoneEnabled;
    }
  }

  applyRemoteVolume();
  updateVoiceStatus();
  renderPeople();
  syncPeerMedia();
});

micTestToggle.addEventListener("click", toggleMicrophoneTest);
pushToTalkKeyButton.addEventListener("click", () => {
  if (selectedRole === "listener") {
    return;
  }
  isBindingPushToTalkKey = true;
  updateVoiceStatus();
  pushToTalkKeyButton.focus();
});
pushToTalkButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  setPushToTalk(true);
});
pushToTalkButton.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    setPushToTalk(true);
  }
});
pushToTalkButton.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") {
    setPushToTalk(false);
  }
});
window.addEventListener("keydown", handlePushToTalkKeyDown, true);
window.addEventListener("keyup", handlePushToTalkKeyUp, true);
window.addEventListener("pointerup", () => setPushToTalk(false));
window.addEventListener("pointercancel", () => setPushToTalk(false));
window.addEventListener("blur", () => setPushToTalk(false));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setPushToTalk(false);
  }
});
volumeToggle.addEventListener("click", () => {
  const isExpanded = volumeToggle.getAttribute("aria-expanded") === "true";
  volumeToggle.setAttribute("aria-expanded", String(!isExpanded));
  volumeControl.classList.toggle("is-hidden", isExpanded);
  if (!isExpanded) {
    syncAudioElements();
    remoteVolume.focus();
  }
});
remoteVolume.addEventListener("input", () => {
  const volume = Number(remoteVolume.value);
  applyRemoteVolume();
  remoteVolumeValue.textContent = `${volume}%`;
});
document.querySelector("#copy-invite-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    copyStatus.textContent = "Kod skopiowany.";
  } catch (error) {
    copyStatus.textContent = "Nie udało się skopiować kodu.";
    showToast(`Kopiowanie nie powiodło się: ${error.message}`);
  }
});

document.querySelector("#leave-room").addEventListener("click", async () => {
  leaveRoom();
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await initializeAccess();
  } catch (error) {
    showToast(`Nie udało się opuścić pokoju: ${error.message}`);
  }
});
document.querySelector("#self-chip").addEventListener("click", () => {
  const nextName = window.prompt("Zmień swoją nazwę:", nickname);
  if (nextName?.trim()) {
    if (!send({ type: "nickname", nickname: nextName.trim().slice(0, 24) })) {
      showToast("Nie można zmienić nazwy bez połączenia z pokojem.");
    }
  }
});

logoutButton.addEventListener("click", async () => {
  leaveRoom();
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await initializeAccess();
  } catch (error) {
    showToast(`Nie udało się wylogować: ${error.message}`);
  }
});

updateRoleButtons();
updateVoiceStatus();
void initializeAccess();
