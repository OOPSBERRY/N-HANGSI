// ========================================================================
// N행시 대회 - app.js
// Firebase(Firestore) 기반 실시간 데이터 연동
// ------------------------------------------------------------------------
// 1) https://console.firebase.google.com 에서 프로젝트를 생성하세요.
// 2) "웹 앱"으로 등록한 뒤(빌드 도구 필요 없음), 아래 firebaseConfig 값을
//    발급받은 값으로 교체하세요. (프로젝트 설정 > 일반 > 내 앱 > SDK 설정 및 구성)
// 3) Firestore Database를 만드세요(테스트 모드로 시작 가능). 배포 전에는
//    이 파일 맨 아래 주석에 있는 보안 규칙을 Firestore "규칙" 탭에 붙여넣으세요.
// 4) 처음 라운드 결과/시상식을 열 때 브라우저 콘솔에 "색인이 필요합니다"라는
//    안내와 함께 링크가 뜰 수 있어요. 그 링크를 한 번 클릭해 색인을 만들면
//    이후에는 정상 동작합니다(Firestore의 정상적인 동작 방식입니다).
// ========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, runTransaction, increment,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBmb_CXuCoBUfdPDaFm2j2kj9rXfQ7UXJU",
  authDomain: "n-hangsi.firebaseapp.com",
  projectId: "n-hangsi",
  storageBucket: "n-hangsi.firebasestorage.app",
  messagingSenderId: "563497062350",
  appId: "1:563497062350:web:3410c1827d4cc5355ea59f",
  measurementId: "G-MXTQY7KM7M",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ------------------------------------------------------------------------
// 공용 유틸
// ------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  $(id).classList.add("active");
}

function showStage(scopeEl, stageId) {
  scopeEl.querySelectorAll(".stage").forEach((el) => el.classList.remove("active"));
  const target = scopeEl.querySelector("#" + stageId);
  if (target) target.classList.add("active");
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function genRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function splitSyllables(word) {
  return Array.from(word.trim());
}

function joinUrl(code) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", code);
  return url.toString();
}

function qrUrl(dataUrl) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=" + encodeURIComponent(dataUrl);
}

function computeRemaining(startAtTimestamp, durationSeconds) {
  if (!startAtTimestamp || !startAtTimestamp.toMillis) return durationSeconds;
  const elapsed = (Date.now() - startAtTimestamp.toMillis()) / 1000;
  return Math.max(0, Math.round(durationSeconds - elapsed));
}

function spawnConfetti(container) {
  container.innerHTML = "";
  const colors = ["#ff6b6b", "#4d96ff", "#ffd166", "#06d6a0", "#c77dff"];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("div");
    p.className = "confetti-piece";
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = (2.5 + Math.random() * 2) + "s";
    p.style.animationDelay = (Math.random() * 2) + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(p);
  }
}

// ------------------------------------------------------------------------
// 학생 대기 화면에 보여줄 "기발한 학생 N행시" 예시
// (사진 속 손글씨를 옮긴 것이라 실제 문구와 다를 수 있어요. 필요하면 아래
//  배열 내용을 자유롭게 수정하세요.)
// ------------------------------------------------------------------------
const FUN_EXAMPLES = [
  {
    title: "소나기 (3행시)",
    lines: [
      ["소", "소방차가 불난 집 불을 끈다"],
      ["나", "나는 신나게 구경을 했다"],
      ["기", "기절했다. 우리 집이었다"],
    ],
  },
  {
    title: "장애인의 날 (5행시)",
    lines: [
      ["장", "애벌레가 나비가 됨"],
      ["애", "벌레도"],
      ["인", "간들이 무관심한 사이에도"],
      ["의", "지를 가지고"],
      ["날", "아가는 꿈을 꾼다"],
    ],
  },
];

function renderFunExample(index) {
  const box = $("s-wait-examples");
  if (!box) return;
  const i = index % FUN_EXAMPLES.length;
  const ex = FUN_EXAMPLES[i];
  const linesHtml = ex.lines
    .map(([ch, text]) => `<div class="fun-example-line"><div class="fx-char">${escapeHtml(ch)}</div><div>${escapeHtml(text)}</div></div>`)
    .join("");
  const dotsHtml = FUN_EXAMPLES.map((_, di) => `<span class="${di === i ? "active" : ""}"></span>`).join("");
  box.innerHTML = `
    <div class="fun-examples-label">✨ 기발한 학생 N행시 모음</div>
    <div class="fun-example-title">${escapeHtml(ex.title)}</div>
    ${linesHtml}
    <div class="fun-example-dots">${dotsHtml}</div>`;
}

function startFunExamples() {
  if (state.funExampleInterval) return;
  state.funExampleIndex = 0;
  renderFunExample(0);
  state.funExampleInterval = setInterval(() => {
    state.funExampleIndex++;
    renderFunExample(state.funExampleIndex);
  }, 4500);
}

function stopFunExamples() {
  clearInterval(state.funExampleInterval);
  state.funExampleInterval = null;
}

// ------------------------------------------------------------------------
// 전역 상태
// ------------------------------------------------------------------------
const state = {
  role: null,
  roomCode: null,
  roomData: null,
  participants: [],
  participantId: null,
  studentName: null,
  submittedSet: new Set(),
  votedSet: new Set(),
  unsubRoom: null,
  unsubParticipants: null,
  unsubRoundExtra: null,
  unsubVoteList: null,
  writeTimerInterval: null,
  voteTimerInterval: null,
  lastTeacherKey: null,
  lastStudentKey: null,
  autoEndFired: false,
  funExampleInterval: null,
  funExampleIndex: 0,
};

function resetToHome() {
  stopTeacherListeners();
  stopStudentListeners();
  localStorage.removeItem("nhangsi_teacher_room");
  localStorage.removeItem("nhangsi_session");
  state.role = null;
  state.roomCode = null;
  state.roomData = null;
  state.participantId = null;
  showScreen("screen-home");
}

// ========================================================================
// 선생님 (교사) 로직
// ========================================================================
function resetTeacherSetupForm() {
  $("setup-step-words").classList.add("hidden");
  $("setup-step-count").classList.remove("hidden");
  $("input-word-count").value = 3;
  $("word-inputs-wrap").innerHTML = "";
}

function goToWordInputStep() {
  let count = parseInt($("input-word-count").value, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > 20) count = 20;
  $("input-word-count").value = count;

  const wrap = $("word-inputs-wrap");
  wrap.innerHTML = "";
  for (let i = 1; i <= count; i++) {
    const row = document.createElement("div");
    row.className = "word-input-item";
    row.innerHTML = `<div class="word-index">${i}</div><input type="text" class="input" maxlength="10" placeholder="제시어 ${i}" />`;
    wrap.appendChild(row);
  }

  $("setup-step-count").classList.add("hidden");
  $("setup-step-words").classList.remove("hidden");
  wrap.querySelector("input")?.focus();
}

async function createRoom() {
  const wordInputs = Array.from(document.querySelectorAll("#word-inputs-wrap input"));
  const rawWords = wordInputs.map((inp) => inp.value.trim());
  if (rawWords.some((w) => !w)) { toast("모든 제시어 칸을 입력하세요"); return; }
  const writeSeconds = parseInt($("input-write-seconds").value, 10) || 90;
  const voteSeconds = parseInt($("input-vote-seconds").value, 10) || 45;

  const btn = $("btn-create-room");
  btn.disabled = true;
  try {
    let code, ref, snap;
    for (let i = 0; i < 5; i++) {
      code = genRoomCode();
      ref = doc(db, "rooms", code);
      snap = await getDoc(ref);
      if (!snap.exists()) break;
    }
    await setDoc(ref, {
      code,
      words: rawWords,
      currentRoundIndex: -1,
      status: "lobby",
      writeSeconds,
      voteSeconds,
      participantCount: 0,
      roundStartAt: null,
      voteStartAt: null,
      createdAt: serverTimestamp(),
    });

    localStorage.setItem("nhangsi_teacher_room", code);
    enterTeacherRoom(code);
  } catch (e) {
    console.error(e);
    toast("방 생성에 실패했어요. Firebase 설정을 확인해주세요.");
  } finally {
    btn.disabled = false;
  }
}

function enterTeacherRoom(code) {
  state.role = "teacher";
  state.roomCode = code;

  showScreen("screen-teacher-room");
  $("teacher-room-code").textContent = code;
  $("teacher-qr-img").src = qrUrl(joinUrl(code));

  stopTeacherListeners();

  const roomRef = doc(db, "rooms", code);
  state.unsubRoom = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { toast("방이 종료되었습니다"); resetToHome(); return; }
    state.roomData = { id: snap.id, ...snap.data() };
    renderTeacherStage();
  });

  const partRef = collection(db, "rooms", code, "participants");
  state.unsubParticipants = onSnapshot(query(partRef, orderBy("joinedAt", "asc")), (snap) => {
    state.participants = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderParticipantList();
  });
}

function renderTeacherStage() {
  const room = state.roomData;
  if (!room) return;
  const scope = document.querySelector(".teacher-layout");
  const total = room.words.length;
  const key = room.status + ":" + room.currentRoundIndex;

  if (room.status === "lobby") {
    showStage(scope, "stage-lobby");
  } else if (room.status === "writing") {
    showStage(scope, "stage-writing");
    $("teacher-round-num").textContent = room.currentRoundIndex + 1;
    $("teacher-round-total").textContent = total;
    $("teacher-current-word").textContent = room.words[room.currentRoundIndex];
    $("teacher-total-count").textContent = state.participants.length;
    startWriteTimer(room);
  } else if (room.status === "voting") {
    showStage(scope, "stage-voting");
    $("teacher-round-num-2").textContent = room.currentRoundIndex + 1;
    $("teacher-round-total-2").textContent = total;
    $("teacher-vote-total").textContent = state.participants.length;
    startVoteTimer(room);
  } else if (room.status === "roundResult") {
    clearInterval(state.writeTimerInterval);
    clearInterval(state.voteTimerInterval);
    showStage(scope, "stage-round-result");
    renderTeacherRoundResult(room);
    const isLast = room.currentRoundIndex >= total - 1;
    $("btn-next-round").classList.toggle("hidden", isLast);
    $("btn-show-final").classList.toggle("hidden", !isLast);
  } else if (room.status === "finalResult") {
    clearInterval(state.writeTimerInterval);
    clearInterval(state.voteTimerInterval);
    showStage(scope, "stage-final");
    renderFinal($("podium"), $("confetti-wrap"));
  }

  if (key !== state.lastTeacherKey) {
    state.lastTeacherKey = key;
    state.autoEndFired = false;
    attachRoundCountListener(room);
  }
}

function attachRoundCountListener(room) {
  if (state.unsubRoundExtra) { state.unsubRoundExtra(); state.unsubRoundExtra = null; }
  state.submittedSet = new Set();
  state.votedSet = new Set();

  if (room.status === "writing") {
    const subsRef = collection(db, "rooms", state.roomCode, "submissions");
    const q = query(subsRef, where("roundIndex", "==", room.currentRoundIndex));
    state.unsubRoundExtra = onSnapshot(q, (snap) => {
      state.submittedSet = new Set(snap.docs.map((d) => d.data().participantId));
      $("teacher-submit-count").textContent = snap.size;
      renderParticipantList();
    });
  } else if (room.status === "voting") {
    const votesRef = collection(db, "rooms", state.roomCode, "votes");
    const q = query(votesRef, where("roundIndex", "==", room.currentRoundIndex));
    state.unsubRoundExtra = onSnapshot(q, (snap) => {
      state.votedSet = new Set(snap.docs.map((d) => d.data().voterId));
      $("teacher-vote-count").textContent = snap.size;
      renderParticipantList();
    });
  } else {
    renderParticipantList();
  }
}

function renderParticipantList() {
  $("teacher-participant-count").textContent = state.participants.length;
  const ul = $("teacher-participant-list");
  ul.innerHTML = "";
  const status = state.roomData ? state.roomData.status : null;
  state.participants.forEach((p) => {
    const li = document.createElement("li");
    let done = false;
    if (status === "writing") done = state.submittedSet.has(p.id);
    if (status === "voting") done = state.votedSet.has(p.id);
    li.className = done ? "done" : "";
    li.textContent = (done ? "✅ " : "👤 ") + p.name;
    ul.appendChild(li);
  });
}

function startWriteTimer(room) {
  clearInterval(state.writeTimerInterval);
  const tick = () => {
    const remain = computeRemaining(room.roundStartAt, room.writeSeconds);
    $("teacher-write-timer").textContent = remain;
    document.querySelector("#stage-writing .timer-ring").classList.toggle("urgent", remain <= 10);
    if (remain <= 0 && !state.autoEndFired) {
      state.autoEndFired = true;
      endWriting();
    }
  };
  tick();
  state.writeTimerInterval = setInterval(tick, 1000);
}

function startVoteTimer(room) {
  clearInterval(state.voteTimerInterval);
  const tick = () => {
    const remain = computeRemaining(room.voteStartAt, room.voteSeconds);
    $("teacher-vote-timer").textContent = remain;
    document.querySelector("#stage-voting .timer-ring").classList.toggle("urgent", remain <= 10);
    if (remain <= 0 && !state.autoEndFired) {
      state.autoEndFired = true;
      endVoting();
    }
  };
  tick();
  state.voteTimerInterval = setInterval(tick, 1000);
}

async function startRound() {
  const room = state.roomData;
  const nextIndex = room.currentRoundIndex + 1;
  if (nextIndex >= room.words.length) return;
  await updateDoc(doc(db, "rooms", state.roomCode), {
    currentRoundIndex: nextIndex,
    status: "writing",
    roundStartAt: serverTimestamp(),
    voteStartAt: null,
  });
}

async function endWriting() {
  clearInterval(state.writeTimerInterval);
  await updateDoc(doc(db, "rooms", state.roomCode), {
    status: "voting",
    voteStartAt: serverTimestamp(),
  });
}

async function endVoting() {
  clearInterval(state.voteTimerInterval);
  await updateDoc(doc(db, "rooms", state.roomCode), { status: "roundResult" });
}

async function showFinalStage() {
  await updateDoc(doc(db, "rooms", state.roomCode), { status: "finalResult" });
}

async function renderTeacherRoundResult(room) {
  const list = $("round-result-list");
  try {
    const subsRef = collection(db, "rooms", state.roomCode, "submissions");
    const q = query(subsRef, where("roundIndex", "==", room.currentRoundIndex), orderBy("voteCount", "desc"), limit(5));
    const snap = await getDocs(q);
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = '<p class="stage-desc">제출된 작품이 없어요</p>';
      return;
    }
    snap.docs.forEach((d, i) => {
      const data = d.data();
      const div = document.createElement("div");
      div.className = "result-item" + (i === 0 ? " top1" : "");
      div.innerHTML = `
        <div>
          <div><span class="result-rank">${i + 1}위</span><span class="result-name">${escapeHtml(data.name)}</span></div>
          <div class="result-text">${escapeHtml(data.text)}</div>
        </div>
        <div class="result-votes">${data.voteCount || 0}표</div>`;
      list.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    list.innerHTML = '<p class="stage-desc">결과를 불러오지 못했어요 (콘솔의 색인 생성 링크를 확인하세요)</p>';
  }
}

async function renderFinal(podiumEl, confettiEl) {
  try {
    const partRef = collection(db, "rooms", state.roomCode, "participants");
    const q = query(partRef, orderBy("totalScore", "desc"), limit(3));
    const snap = await getDocs(q);
    const top = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    podiumEl.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    top.forEach((p, i) => {
      const div = document.createElement("div");
      div.className = "podium-place podium-" + (i + 1);
      div.innerHTML = `<div class="medal">${medals[i]}</div><div class="p-name">${escapeHtml(p.name)}</div><div class="p-score">${p.totalScore || 0}표</div>`;
      podiumEl.appendChild(div);
    });
    spawnConfetti(confettiEl);
  } catch (e) {
    console.error(e);
  }
}

async function endGame() {
  if (!confirm("게임을 종료할까요? 학생들의 화면도 함께 종료됩니다.")) return;
  await deleteDoc(doc(db, "rooms", state.roomCode));
  resetToHome();
}

function teacherRestart() {
  resetToHome();
  resetTeacherSetupForm();
  showScreen("screen-teacher-setup");
}

function stopTeacherListeners() {
  [state.unsubRoom, state.unsubParticipants, state.unsubRoundExtra].forEach((fn) => fn && fn());
  state.unsubRoom = null;
  state.unsubParticipants = null;
  state.unsubRoundExtra = null;
  clearInterval(state.writeTimerInterval);
  clearInterval(state.voteTimerInterval);
  state.lastTeacherKey = null;
}

// ========================================================================
// 학생 로직
// ========================================================================
async function joinRoom() {
  const code = $("input-room-code").value.trim();
  const name = $("input-student-name").value.trim();
  if (!/^\d{6}$/.test(code)) { toast("방 코드 6자리를 확인해주세요"); return; }
  if (!name) { toast("이름을 입력해주세요"); return; }

  const btn = $("btn-join-room");
  btn.disabled = true;
  try {
    const roomRef = doc(db, "rooms", code);
    const snap = await getDoc(roomRef);
    if (!snap.exists()) { toast("존재하지 않는 방 코드입니다"); return; }
    const room = snap.data();
    if (room.status !== "lobby") { toast("이미 시작된 게임이라 입장할 수 없어요"); return; }

    const participantId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
    await setDoc(doc(db, "rooms", code, "participants", participantId), {
      name, joinedAt: serverTimestamp(), totalScore: 0,
    });
    await updateDoc(roomRef, { participantCount: increment(1) });

    const session = { roomCode: code, participantId, name };
    localStorage.setItem("nhangsi_session", JSON.stringify(session));
    enterStudentRoom(session);
  } catch (e) {
    console.error(e);
    toast("입장에 실패했어요. Firebase 설정을 확인해주세요.");
  } finally {
    btn.disabled = false;
  }
}

function enterStudentRoom(session) {
  state.role = "student";
  state.roomCode = session.roomCode;
  state.participantId = session.participantId;
  state.studentName = session.name;

  showScreen("screen-student-room");
  $("student-name-chip").textContent = session.name;
  $("student-room-code-chip").textContent = session.roomCode;

  stopStudentListeners();

  const roomRef = doc(db, "rooms", session.roomCode);
  state.unsubRoom = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) { toast("방이 종료되었습니다"); resetToHome(); return; }
    state.roomData = { id: snap.id, ...snap.data() };
    renderStudentStage();
  });
}

async function renderStudentStage() {
  const room = state.roomData;
  const scope = document.querySelector(".student-layout");
  const key = room.status + ":" + room.currentRoundIndex;

  if (room.status === "lobby") {
    showStage(scope, "s-stage-wait");
    $("s-wait-title").textContent = "선생님이 라운드를 시작할 때까지 기다려주세요";
    $("s-wait-participant-count").textContent = room.participantCount || 0;
    stopStudentExtraTimer();
    startFunExamples();
    state.lastStudentKey = key;
    return;
  }

  if (room.status === "writing") {
    stopFunExamples();
    const subRef = doc(db, "rooms", state.roomCode, "submissions", room.currentRoundIndex + "_" + state.participantId);
    const subSnap = await getDoc(subRef);
    if (subSnap.exists()) {
      showStage(scope, "s-stage-submitted");
      $("s-my-submission").textContent = subSnap.data().text;
      stopStudentExtraTimer();
    } else {
      showStage(scope, "s-stage-writing");
      if (key !== state.lastStudentKey) buildWriteForm(room.words[room.currentRoundIndex]);
      $("s-round-num").textContent = room.currentRoundIndex + 1;
      $("s-current-word").textContent = room.words[room.currentRoundIndex];
      startStudentWriteTimer(room);
    }
    state.lastStudentKey = key;
    return;
  }

  if (room.status === "voting") {
    const voteRef = doc(db, "rooms", state.roomCode, "votes", room.currentRoundIndex + "_" + state.participantId);
    const voteSnap = await getDoc(voteRef);
    if (voteSnap.exists()) {
      showStage(scope, "s-stage-voted");
      stopStudentExtraTimer();
      if (state.unsubVoteList) { state.unsubVoteList(); state.unsubVoteList = null; }
    } else {
      showStage(scope, "s-stage-voting");
      startStudentVoteTimer(room);
      if (key !== state.lastStudentKey) attachVoteListListener(room);
    }
    state.lastStudentKey = key;
    return;
  }

  if (room.status === "roundResult") {
    stopStudentExtraTimer();
    if (state.unsubVoteList) { state.unsubVoteList(); state.unsubVoteList = null; }
    showStage(scope, "s-stage-round-result");
    await renderStudentRoundResult(room);
    state.lastStudentKey = key;
    return;
  }

  if (room.status === "finalResult") {
    stopStudentExtraTimer();
    showStage(scope, "s-stage-final");
    await renderFinal($("s-podium"), $("s-confetti-wrap"));
    state.lastStudentKey = key;
    return;
  }
}

function buildWriteForm(word) {
  const wrap = $("s-write-lines");
  wrap.innerHTML = "";
  splitSyllables(word).forEach((ch) => {
    const row = document.createElement("div");
    row.className = "write-line";
    row.innerHTML = `<div class="syllable">${escapeHtml(ch)}</div><input type="text" placeholder="'${escapeHtml(ch)}'(으)로 시작하는 문장" maxlength="40" />`;
    wrap.appendChild(row);
  });
}

async function submitNhangsi() {
  const room = state.roomData;
  const word = room.words[room.currentRoundIndex];
  const chars = splitSyllables(word);
  const inputs = Array.from($("s-write-lines").querySelectorAll("input"));
  const lines = inputs.map((inp) => inp.value.trim());
  if (lines.some((l) => !l)) { toast("모든 줄을 입력해주세요"); return; }

  const text = chars.map((ch, i) => `${ch} : ${lines[i]}`).join("\n");
  const subId = room.currentRoundIndex + "_" + state.participantId;

  const btn = $("btn-submit-nhangsi");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "rooms", state.roomCode, "submissions", subId), {
      roundIndex: room.currentRoundIndex,
      participantId: state.participantId,
      name: state.studentName,
      word, lines, text, voteCount: 0,
      submittedAt: serverTimestamp(),
    });
    toast("제출 완료!");
  } catch (e) {
    console.error(e);
    toast("제출에 실패했어요");
  } finally {
    btn.disabled = false;
  }
}

function attachVoteListListener(room) {
  if (state.unsubVoteList) { state.unsubVoteList(); state.unsubVoteList = null; }
  const subsRef = collection(db, "rooms", state.roomCode, "submissions");
  const q = query(subsRef, where("roundIndex", "==", room.currentRoundIndex));
  state.unsubVoteList = onSnapshot(q, (snap) => {
    const list = $("s-vote-list");
    list.innerHTML = "";
    const others = snap.docs.filter((d) => d.data().participantId !== state.participantId);
    others.forEach((d) => {
      const data = d.data();
      const card = document.createElement("div");
      card.className = "vote-card";
      card.textContent = data.text;
      card.addEventListener("click", () => castVote(room.currentRoundIndex, d.id, data.participantId, card));
      list.appendChild(card);
    });
    if (!others.length) {
      list.innerHTML = '<p class="stage-desc">아직 제출된 다른 작품이 없어요</p>';
    }
  });
}

async function castVote(roundIndex, submissionId, targetParticipantId, cardEl) {
  if (targetParticipantId === state.participantId) return;
  const voteRef = doc(db, "rooms", state.roomCode, "votes", roundIndex + "_" + state.participantId);
  const subRef = doc(db, "rooms", state.roomCode, "submissions", submissionId);
  const ownerRef = doc(db, "rooms", state.roomCode, "participants", targetParticipantId);

  document.querySelectorAll("#s-vote-list .vote-card").forEach((c) => c.classList.add("disabled"));
  cardEl.classList.add("selected");

  try {
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(voteRef);
      if (existing.exists()) throw new Error("이미 투표했습니다");
      tx.set(voteRef, {
        roundIndex, voterId: state.participantId,
        submissionId, targetParticipantId, votedAt: serverTimestamp(),
      });
      tx.update(subRef, { voteCount: increment(1) });
      tx.update(ownerRef, { totalScore: increment(1) });
    });
    toast("투표 완료!");
  } catch (e) {
    toast(e.message || "투표에 실패했어요");
    document.querySelectorAll("#s-vote-list .vote-card").forEach((c) => c.classList.remove("disabled"));
    cardEl.classList.remove("selected");
  }
}

async function renderStudentRoundResult(room) {
  const list = $("s-round-result-list");
  try {
    const subsRef = collection(db, "rooms", state.roomCode, "submissions");
    const q = query(subsRef, where("roundIndex", "==", room.currentRoundIndex), orderBy("voteCount", "desc"), limit(5));
    const snap = await getDocs(q);
    list.innerHTML = "";
    snap.docs.forEach((d, i) => {
      const data = d.data();
      const mine = data.participantId === state.participantId;
      const div = document.createElement("div");
      div.className = "result-item" + (i === 0 ? " top1" : "");
      div.innerHTML = `
        <div>
          <div><span class="result-rank">${i + 1}위</span><span class="result-name">${escapeHtml(data.name)}${mine ? " (나)" : ""}</span></div>
          <div class="result-text">${escapeHtml(data.text)}</div>
        </div>
        <div class="result-votes">${data.voteCount || 0}표</div>`;
      list.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    list.innerHTML = '<p class="stage-desc">결과를 불러오지 못했어요</p>';
  }
}

function startStudentWriteTimer(room) {
  clearInterval(state.writeTimerInterval);
  const tick = () => {
    const remain = computeRemaining(room.roundStartAt, room.writeSeconds);
    $("s-write-timer").textContent = remain;
    document.querySelector("#s-stage-writing .timer-ring").classList.toggle("urgent", remain <= 10);
  };
  tick();
  state.writeTimerInterval = setInterval(tick, 1000);
}

function startStudentVoteTimer(room) {
  clearInterval(state.voteTimerInterval);
  const tick = () => {
    const remain = computeRemaining(room.voteStartAt, room.voteSeconds);
    $("s-vote-timer").textContent = remain;
    document.querySelector("#s-stage-voting .timer-ring").classList.toggle("urgent", remain <= 10);
  };
  tick();
  state.voteTimerInterval = setInterval(tick, 1000);
}

function stopStudentExtraTimer() {
  clearInterval(state.writeTimerInterval);
  clearInterval(state.voteTimerInterval);
}

function stopStudentListeners() {
  [state.unsubRoom, state.unsubVoteList].forEach((fn) => fn && fn());
  state.unsubRoom = null;
  state.unsubVoteList = null;
  stopStudentExtraTimer();
  stopFunExamples();
  state.lastStudentKey = null;
}

// ========================================================================
// 이벤트 바인딩
// ========================================================================
document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    stopTeacherListeners();
    stopStudentListeners();
    showScreen(btn.dataset.back);
  });
});

$("btn-go-teacher").addEventListener("click", () => {
  resetTeacherSetupForm();
  showScreen("screen-teacher-setup");
});
$("btn-go-student").addEventListener("click", () => showScreen("screen-student-join"));
$("btn-set-word-count").addEventListener("click", goToWordInputStep);
$("btn-back-to-count").addEventListener("click", () => {
  $("setup-step-words").classList.add("hidden");
  $("setup-step-count").classList.remove("hidden");
});
$("btn-create-room").addEventListener("click", createRoom);
$("btn-start-round").addEventListener("click", startRound);
$("btn-end-writing").addEventListener("click", endWriting);
$("btn-end-voting").addEventListener("click", endVoting);
$("btn-next-round").addEventListener("click", startRound);
$("btn-show-final").addEventListener("click", showFinalStage);
$("btn-teacher-end-game").addEventListener("click", endGame);
$("btn-teacher-restart").addEventListener("click", teacherRestart);
$("btn-join-room").addEventListener("click", joinRoom);
$("btn-submit-nhangsi").addEventListener("click", submitNhangsi);

$("input-room-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
});

// ========================================================================
// 초기 진입: ?room=코드 처리 및 이전 세션(새로고침) 복구
// ========================================================================
(async function init() {
  const params = new URLSearchParams(location.search);
  const roomParam = params.get("room");

  const savedTeacherRoom = localStorage.getItem("nhangsi_teacher_room");
  if (savedTeacherRoom) {
    try {
      const snap = await getDoc(doc(db, "rooms", savedTeacherRoom));
      if (snap.exists()) { enterTeacherRoom(savedTeacherRoom); return; }
    } catch (e) { console.error(e); }
    localStorage.removeItem("nhangsi_teacher_room");
  }

  const savedSessionRaw = localStorage.getItem("nhangsi_session");
  if (savedSessionRaw) {
    try {
      const session = JSON.parse(savedSessionRaw);
      const snap = await getDoc(doc(db, "rooms", session.roomCode, "participants", session.participantId));
      if (snap.exists()) { enterStudentRoom(session); return; }
    } catch (e) { console.error(e); }
    localStorage.removeItem("nhangsi_session");
  }

  if (roomParam) {
    showScreen("screen-student-join");
    $("input-room-code").value = roomParam.replace(/\D/g, "").slice(0, 6);
    return;
  }

  showScreen("screen-home");
})();

// ========================================================================
// Firestore 보안 규칙 (Firebase 콘솔 > Firestore Database > 규칙 탭에 붙여넣기)
// ------------------------------------------------------------------------
// rules_version = '2';
// service cloud.firestore {
//   match /databases/{database}/documents {
//     match /rooms/{roomId} {
//       allow read: if true;
//       allow create: if request.resource.data.keys().hasAll(['code','words','status']);
//       allow update: if true;
//       allow delete: if true;
//
//       match /participants/{pid} {
//         allow read: if true;
//         allow create: if true;
//         allow update: if request.resource.data.diff(resource.data).affectedKeys()
//                         .hasOnly(['totalScore']);
//         allow delete: if false;
//       }
//       match /submissions/{sid} {
//         allow read: if true;
//         allow create: if true;
//         allow update: if request.resource.data.diff(resource.data).affectedKeys()
//                         .hasOnly(['voteCount']);
//         allow delete: if false;
//       }
//       match /votes/{vid} {
//         allow read: if true;
//         allow create: if !exists(/databases/$(database)/documents/rooms/$(roomId)/votes/$(vid));
//         allow update, delete: if false;
//       }
//     }
//   }
// }
// ------------------------------------------------------------------------
// 참고: 위 규칙은 로그인 없이 빠르게 수업에서 쓰기 위한 "낮은 보안" 규칙입니다.
// 학생 인증 없이 방 코드만으로 참여하는 구조이기 때문입니다. 외부에 공개된
// 환경에서 장기간 운영한다면 Firebase Authentication(익명 로그인 등)을
// 추가해 더 엄격한 규칙으로 강화하는 것을 권장합니다.
// ========================================================================
