/**
 * 🎵 ClariCoach AI - 클라리넷 AI 선생님 앱
 * Gemini API를 활용한 맞춤형 연주 피드백 시스템
 * 
 * 주요 기능:
 * - 나이/성별 맞춤 AI 페르소나 피드백
 * - 연주 영상 분석 (음정, 박자, 음색, 셈여림)
 * - 곡 자동 감지
 * - 성장 기록 및 그래프
 * - 온보딩 튜토리얼 / FAQ
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { GoogleGenAI } from "@google/genai";

// ────────────────────────────────────────────────────────────────────────────────
// 상수 및 설정
// ────────────────────────────────────────────────────────────────────────────────

/** 앱 화면 목록 */
const SCREENS = {
  ONBOARDING: "onboarding",
  PROFILE: "profile",
  HOME: "home",
  UPLOAD: "upload",
  ANALYZING: "analyzing",
  FEEDBACK: "feedback",
  HISTORY: "history",
  FAQ: "faq",
};

/** 더미 연습 기록 데이터 (로컬 스토리지 초기값) */
const DUMMY_HISTORY = [
  {
    id: 1,
    date: "2026-05-01",
    song: "아리랑 변주곡",
    scores: { intonation: 72, rhythm: 68, tone: 75, dynamics: 60 },
    overall: 69,
    thumbnail: null,
  },
  {
    id: 2,
    date: "2026-05-08",
    song: "엘리제를 위하여",
    scores: { intonation: 78, rhythm: 74, tone: 80, dynamics: 70 },
    overall: 76,
    thumbnail: null,
  },
  {
    id: 3,
    date: "2026-05-15",
    song: "모차르트 협주곡 2악장",
    scores: { intonation: 82, rhythm: 80, tone: 83, dynamics: 78 },
    overall: 81,
    thumbnail: null,
  },
  {
    id: 4,
    date: "2026-05-22",
    song: "베버 협주주 Op.73",
    scores: { intonation: 85, rhythm: 83, tone: 87, dynamics: 82 },
    overall: 84,
    thumbnail: null,
  },
];

// ────────────────────────────────────────────────────────────────────────────────
// 유틸리티 함수
// ────────────────────────────────────────────────────────────────────────────────

/**
 * 로컬 스토리지에서 연습 기록을 불러온다
 */
const loadHistory = () => {
  try {
    const raw = localStorage.getItem("claricoach_history");
    return raw ? JSON.parse(raw) : DUMMY_HISTORY;
  } catch {
    return DUMMY_HISTORY;
  }
};

/**
 * 로컬 스토리지에 연습 기록을 저장한다
 */
const saveHistory = (records) => {
  try {
    localStorage.setItem("claricoach_history", JSON.stringify(records));
  } catch {
    /* 저장 실패 시 무시 */
  }
};

/**
 * 나이와 성별을 기반으로 AI 페르소나 프롬프트를 생성한다
 */
const buildPersonaPrompt = (age, gender) => {
  const isJunior = age < 15;
  const honorific = gender === "female" ? "학생" : "학생";
  const tone = isJunior
    ? "친근하고 따뜻하게, 쉬운 말로 격려하면서도"
    : "존중하되 진지하게, 또래 언니/오빠 같은 선생님처럼";

  return `당신은 20년 경력의 클라리넷 전문 강사 '박지수 선생님'입니다.
현재 ${age}세 ${gender === "female" ? "여학생" : "남학생"}을 지도하고 있습니다.
말투: ${tone} 전문적인 피드백을 제공하세요.
- 칭찬은 구체적으로, 개선점도 반드시 포함
- 중고등학생 눈높이에 맞는 표현 사용
- 자신감을 키워주는 마무리 멘트 포함
- 마치 실제 레슨실에서 말하듯 생생하게`;
};

/**
 * 비디오 파일에서 base64 데이터를 추출한다
 */
const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// ────────────────────────────────────────────────────────────────────────────────
// API 호출 함수
// ────────────────────────────────────────────────────────────────────────────────

/**
 * Google GenAI SDK(@google/genai)로 클라리넷 연주를 분석한다
 *
 * 비디오: SDK의 ai.files.upload() → URI 참조로 generateContent
 * 이미지: inline base64로 직접 전송
 * SDK 사용으로 File API 헤더/포맷 문제 완전 해소
 */
const analyzePerformance = async (videoFile, age, gender, apiKey) => {
  const personaPrompt = buildPersonaPrompt(age, gender);
  const isVideo = videoFile.type.startsWith("video/");
  const isImage = videoFile.type.startsWith("image/");

  // Google GenAI SDK 초기화
  const ai = new GoogleGenAI({ apiKey });

  // JSON 응답 스키마
  const jsonSchema = `{
  "detectedSong": "감지된 곡명 (모르면 '곡명 미상')",
  "scores": { "intonation": 0~100숫자, "rhythm": 0~100숫자, "tone": 0~100숫자, "dynamics": 0~100숫자 },
  "overall": 0~100숫자,
  "praise": "잘한 점 2-3문장",
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "coachComment": "선생님 스타일의 따뜻하고 전문적인 총평 3-4문장",
  "nextGoal": "다음 연습 목표 1문장",
  "encouragement": "격려 메시지 1문장"
}`;

  const basePrompt = `${personaPrompt}\n\n반드시 아래 JSON 형식으로만 응답하세요 (코드블록 없이 순수 JSON):\n${jsonSchema}`;

  let contents;

  if (isVideo) {
    // ── 비디오: SDK File API로 업로드 후 URI 참조 ──────────────────────
    // SDK가 내부적으로 올바른 resumable upload 프로토콜을 처리해 줌
    const uploadedFile = await ai.files.upload({
      file: videoFile,
      config: { mimeType: videoFile.type, displayName: videoFile.name },
    });

    // 비디오는 처리 완료까지 대기 (PROCESSING → ACTIVE)
    let fileInfo = await ai.files.get({ name: uploadedFile.name });
    let waitCount = 0;
    while (fileInfo.state === "PROCESSING" && waitCount < 12) {
      await new Promise((r) => setTimeout(r, 5000)); // 5초 대기
      fileInfo = await ai.files.get({ name: uploadedFile.name });
      waitCount++;
    }
    if (fileInfo.state === "FAILED") {
      throw new Error("비디오 처리에 실패했습니다. 다른 파일을 시도해주세요.");
    }

    contents = [
      { fileData: { mimeType: videoFile.type, fileUri: fileInfo.uri } },
      { text: `${basePrompt}\n\n이 클라리넷 연주 영상을 분석해주세요.` },
    ];

  } else if (isImage) {
    // ── 이미지: inline base64 직접 전송 ────────────────────────────────
    const b64 = await fileToBase64(videoFile);
    contents = [
      { inlineData: { mimeType: videoFile.type, data: b64 } },
      { text: `${basePrompt}\n\n이 이미지를 바탕으로 클라리넷 연주자에게 피드백을 주세요.` },
    ];

  } else {
    // ── 텍스트 전용 ─────────────────────────────────────────────────────
    contents = [{ text: `${basePrompt}\n\n클라리넷 연주자를 위한 일반적인 피드백을 생성해주세요.` }];
  }

  // ── Gemini 2.0 Flash로 분석 요청 ────────────────────────────────────
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: contents }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  });

  const rawText = response.text ?? "";
  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  return JSON.parse(cleaned);
};

// ────────────────────────────────────────────────────────────────────────────────
// 하위 컴포넌트들
// ────────────────────────────────────────────────────────────────────────────────

/** 음표 애니메이션 배경 */
const MusicNotes = () => {
  const notes = ["♩", "♪", "♫", "♬", "𝄞"];
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {[...Array(12)].map((_, i) => (
        <span
          key={i}
          className="absolute text-amber-200/20 text-2xl animate-float"
          style={{
            left: `${(i * 8.3) % 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${i * 0.7}s`,
            animationDuration: `${4 + (i % 3)}s`,
            fontSize: `${16 + (i % 3) * 8}px`,
          }}
        >
          {notes[i % notes.length]}
        </span>
      ))}
    </div>
  );
};

/** 점수 원형 게이지 */
const ScoreRing = ({ score, label, color = "#F59E0B", size = 80 }) => {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="rotate-[-90deg]">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e1e2e" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1.2s ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center" style={{ marginTop: size * 0.28 }}>
        <span className="text-white font-bold text-lg leading-none">{score}</span>
      </div>
      <span className="text-xs text-amber-300/70 font-medium">{label}</span>
    </div>
  );
};

/** 성장 그래프 (SVG 라인 차트) */
const GrowthChart = ({ history }) => {
  const w = 340, h = 140, pad = 30;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  if (history.length < 2) return null;

  const points = history.map((r, i) => ({
    x: pad + (i / (history.length - 1)) * innerW,
    y: pad + innerH - ((r.overall - 50) / 50) * innerH,
    score: r.overall,
    date: r.date.slice(5),
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${h - pad} L ${pad} ${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 격자 */}
      {[60, 70, 80, 90].map((v) => {
        const y = pad + innerH - ((v - 50) / 50) * innerH;
        return (
          <g key={v}>
            <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#ffffff10" strokeWidth="1" />
            <text x={pad - 4} y={y + 4} fill="#ffffff40" fontSize="9" textAnchor="end">{v}</text>
          </g>
        );
      })}
      {/* 영역 채우기 */}
      <path d={areaD} fill="url(#areaGrad)" />
      {/* 라인 */}
      <path d={pathD} fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* 점들 */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="5" fill="#F59E0B" stroke="#1a1a2e" strokeWidth="2" />
          <text x={p.x} y={h - 8} fill="#ffffff60" fontSize="8" textAnchor="middle">{p.date}</text>
        </g>
      ))}
    </svg>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// 화면 컴포넌트
// ────────────────────────────────────────────────────────────────────────────────

/** 온보딩 화면 */
const OnboardingScreen = ({ onComplete }) => {
  const [step, setStep] = useState(0);

  const slides = [
    {
      icon: "🎵",
      title: "ClariCoach AI에 오신 것을 환영해요!",
      desc: "AI 선생님이 여러분의 클라리넷 연주를 듣고, 실제 레슨처럼 전문적인 피드백을 드립니다.",
    },
    {
      icon: "🎬",
      title: "연주 영상을 올려보세요",
      desc: "스마트폰으로 찍은 연주 영상을 업로드하면 AI가 음정, 박자, 음색, 셈여림을 분석해요.",
    },
    {
      icon: "🔍",
      title: "곡도 자동으로 감지해요",
      desc: "어떤 곡을 연주했는지 AI가 판단하고, 그 곡에 맞는 맞춤 조언을 드려요.",
    },
    {
      icon: "📈",
      title: "성장을 눈으로 확인하세요",
      desc: "매번 연주 기록이 쌓여 여러분의 실력 향상 그래프를 한눈에 볼 수 있어요!",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 50%, #0d1117 100%)" }}>
      <MusicNotes />
      <div className="relative z-10 w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">{slides[step].icon}</div>
          <div className="w-12 h-0.5 bg-amber-400 mx-auto mb-6" />
          <h2 className="text-white text-xl font-bold mb-3" style={{ fontFamily: "Georgia, serif" }}>
            {slides[step].title}
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">{slides[step].desc}</p>
        </div>

        {/* 진행 점 */}
        <div className="flex justify-center gap-2 mb-8">
          {slides.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === step ? 24 : 8,
                height: 8,
                background: i === step ? "#F59E0B" : "#ffffff30",
              }}
            />
          ))}
        </div>

        {/* 버튼 */}
        <button
          onClick={() => (step < slides.length - 1 ? setStep(step + 1) : onComplete())}
          className="w-full py-4 rounded-2xl font-bold text-black text-lg transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg, #F59E0B, #D97706)" }}
        >
          {step < slides.length - 1 ? "다음" : "시작하기 →"}
        </button>

        {step < slides.length - 1 && (
          <button onClick={onComplete} className="w-full mt-3 py-2 text-white/40 text-sm">
            건너뛰기
          </button>
        )}
      </div>
    </div>
  );
};

/** 프로필 입력 화면 */
const ProfileScreen = ({ onSave }) => {
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");

  const canSubmit = age && gender && name && apiKey;

  return (
    <div className="min-h-screen flex flex-col px-6 py-10" style={{ background: "linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 50%, #0d1117 100%)" }}>
      <MusicNotes />
      <div className="relative z-10 w-full max-w-sm mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎼</div>
          <h1 className="text-white text-2xl font-bold mb-1" style={{ fontFamily: "Georgia, serif" }}>
            내 정보 입력
          </h1>
          <p className="text-white/50 text-sm">AI 선생님이 맞춤 피드백을 드릴게요</p>
        </div>

        <div className="space-y-4">
          {/* 이름 */}
          <div>
            <label className="text-amber-300/80 text-xs font-semibold mb-1.5 block">이름 (닉네임)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 김민지"
              className="w-full rounded-xl px-4 py-3 text-white text-sm outline-none"
              style={{ background: "#ffffff0d", border: "1px solid #ffffff15" }}
            />
          </div>

          {/* 나이 */}
          <div>
            <label className="text-amber-300/80 text-xs font-semibold mb-1.5 block">나이</label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="예: 15"
              min={10}
              max={20}
              className="w-full rounded-xl px-4 py-3 text-white text-sm outline-none"
              style={{ background: "#ffffff0d", border: "1px solid #ffffff15" }}
            />
          </div>

          {/* 성별 */}
          <div>
            <label className="text-amber-300/80 text-xs font-semibold mb-1.5 block">성별</label>
            <div className="grid grid-cols-2 gap-3">
              {["female", "male"].map((g) => (
                <button
                  key={g}
                  onClick={() => setGender(g)}
                  className="py-3 rounded-xl text-sm font-semibold transition-all"
                  style={{
                    background: gender === g ? "linear-gradient(135deg, #F59E0B, #D97706)" : "#ffffff0d",
                    color: gender === g ? "#000" : "#fff8",
                    border: `1px solid ${gender === g ? "transparent" : "#ffffff15"}`,
                  }}
                >
                  {g === "female" ? "👩 여자" : "👦 남자"}
                </button>
              ))}
            </div>
          </div>

          {/* API 키 */}
          <div>
            <label className="text-amber-300/80 text-xs font-semibold mb-1.5 block">
              Google Gemini API Key
              <span className="text-white/30 font-normal ml-1">(AIza...)</span>
            </label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              type="password"
              className="w-full rounded-xl px-4 py-3 text-white text-sm outline-none font-mono"
              style={{ background: "#ffffff0d", border: "1px solid #ffffff15" }}
            />
            <p className="text-white/25 text-xs mt-1.5">🔒 키는 기기 내에만 저장됩니다 · 신용카드 불필요 · 무료 1,500회/일</p>
          </div>
        </div>

        <button
          onClick={() => canSubmit && onSave({ name, age: parseInt(age), gender, apiKey })}
          disabled={!canSubmit}
          className="w-full mt-8 py-4 rounded-2xl font-bold text-black text-lg transition-all active:scale-95"
          style={{
            background: canSubmit ? "linear-gradient(135deg, #F59E0B, #D97706)" : "#ffffff20",
            color: canSubmit ? "#000" : "#fff4",
          }}
        >
          AI 선생님 만나러 가기 →
        </button>
      </div>
    </div>
  );
};

/** 홈 화면 */
const HomeScreen = ({ user, history, onNavigate }) => {
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const improvement = latest && prev ? latest.overall - prev.overall : null;

  return (
    <div
      className="min-h-screen pb-24"
      style={{ background: "linear-gradient(180deg, #0d0d1a 0%, #1a1a2e 100%)" }}
    >
      <MusicNotes />
      <div className="relative z-10 px-5 pt-12">
        {/* 헤더 */}
        <div className="flex justify-between items-start mb-8">
          <div>
            <p className="text-amber-400 text-xs font-semibold mb-0.5">안녕하세요,</p>
            <h1 className="text-white text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>
              {user.name} 학생 👋
            </h1>
            <p className="text-white/40 text-xs mt-1">오늘도 한 단계 성장할 준비가 됐나요?</p>
          </div>
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl"
            style={{ background: "linear-gradient(135deg, #F59E0B30, #F59E0B10)", border: "1px solid #F59E0B30" }}
          >
            🎷
          </div>
        </div>

        {/* 최근 점수 카드 */}
        {latest && (
          <div
            className="rounded-3xl p-5 mb-5"
            style={{ background: "linear-gradient(135deg, #F59E0B15, #F59E0B05)", border: "1px solid #F59E0B25" }}
          >
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-white/50 text-xs">최근 연주</p>
                <p className="text-white font-semibold text-sm mt-0.5">{latest.song}</p>
                <p className="text-white/30 text-xs">{latest.date}</p>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold" style={{ fontFamily: "Georgia, serif", color: "#F59E0B" }}>
                  {latest.overall}
                </p>
                <p className="text-white/40 text-xs">/ 100</p>
                {improvement !== null && (
                  <p className={`text-xs font-semibold mt-1 ${improvement >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {improvement >= 0 ? `▲ +${improvement}` : `▼ ${improvement}`} 지난 번 대비
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: "intonation", label: "음정", color: "#60A5FA" },
                { key: "rhythm", label: "박자", color: "#34D399" },
                { key: "tone", label: "음색", color: "#F59E0B" },
                { key: "dynamics", label: "셈여림", color: "#F472B6" },
              ].map(({ key, label, color }) => (
                <div key={key} className="text-center">
                  <div
                    className="text-lg font-bold"
                    style={{ color }}
                  >
                    {latest.scores[key]}
                  </div>
                  <div className="text-white/40 text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 성장 그래프 미니 */}
        {history.length >= 2 && (
          <div
            className="rounded-3xl p-5 mb-5"
            style={{ background: "#ffffff05", border: "1px solid #ffffff10" }}
          >
            <div className="flex justify-between items-center mb-3">
              <p className="text-white/70 text-sm font-semibold">📈 성장 그래프</p>
              <button
                onClick={() => onNavigate(SCREENS.HISTORY)}
                className="text-amber-400 text-xs"
              >
                전체 보기 →
              </button>
            </div>
            <GrowthChart history={history} />
          </div>
        )}

        {/* 메인 CTA */}
        <button
          onClick={() => onNavigate(SCREENS.UPLOAD)}
          className="w-full py-5 rounded-3xl font-bold text-black text-lg mb-4 active:scale-95 transition-all"
          style={{ background: "linear-gradient(135deg, #F59E0B, #D97706)" }}
        >
          🎵 오늘의 연주 올리기
        </button>

        {/* 빠른 메뉴 */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "연주 기록", icon: "📋", screen: SCREENS.HISTORY },
            { label: "FAQ", icon: "❓", screen: SCREENS.FAQ },
          ].map(({ label, icon, screen }) => (
            <button
              key={screen}
              onClick={() => onNavigate(screen)}
              className="py-4 rounded-2xl font-semibold text-white/70 text-sm transition-all active:scale-95"
              style={{ background: "#ffffff08", border: "1px solid #ffffff10" }}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/** 업로드 화면 */
const UploadScreen = ({ user, onAnalyze, onBack }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();

  /** 파일 선택 처리 */
  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: "linear-gradient(180deg, #0d0d1a, #1a1a2e)" }}>
      <div className="px-5 pt-12">
        <button onClick={onBack} className="text-white/50 text-sm mb-6 flex items-center gap-1">
          ← 뒤로
        </button>
        <h2 className="text-white text-xl font-bold mb-1" style={{ fontFamily: "Georgia, serif" }}>
          연주 영상 업로드
        </h2>
        <p className="text-white/40 text-xs mb-6">
          {user.name} 학생의 연주를 AI 선생님이 분석해드려요
        </p>

        {/* 업로드 영역 */}
        <div
          className="rounded-3xl p-6 mb-5 text-center cursor-pointer transition-all"
          style={{
            background: dragging ? "#F59E0B10" : "#ffffff05",
            border: `2px dashed ${dragging ? "#F59E0B" : "#ffffff20"}`,
            minHeight: 200,
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current.click()}
        >
          {preview ? (
            file?.type.startsWith("video/") ? (
              <video src={preview} className="w-full rounded-2xl max-h-48 object-cover" controls />
            ) : (
              <img src={preview} className="w-full rounded-2xl max-h-48 object-cover" alt="preview" />
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-36 gap-3">
              <div className="text-4xl">🎬</div>
              <p className="text-white/60 text-sm font-medium">영상을 탭하거나 드래그하여 업로드</p>
              <p className="text-white/30 text-xs">MP4, MOV, AVI, 이미지 파일 지원</p>
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />

        {file && (
          <div
            className="rounded-2xl px-4 py-3 mb-5 flex items-center gap-3"
            style={{ background: "#F59E0B10", border: "1px solid #F59E0B30" }}
          >
            <span className="text-xl">✅</span>
            <div>
              <p className="text-amber-300 text-sm font-semibold">{file.name}</p>
              <p className="text-white/40 text-xs">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          </div>
        )}

        {/* 분석 팁 */}
        <div className="rounded-2xl p-4 mb-6" style={{ background: "#ffffff05", border: "1px solid #ffffff08" }}>
          <p className="text-amber-400 text-xs font-semibold mb-2">💡 좋은 피드백을 위한 팁</p>
          <ul className="space-y-1">
            {["조용한 환경에서 녹화하면 더 정확해요", "전체 곡 또는 한 구절 이상 연주해주세요", "카메라는 정면 또는 45도 각도가 좋아요"].map((t, i) => (
              <li key={i} className="text-white/40 text-xs flex items-start gap-1.5">
                <span className="text-amber-400/60 mt-0.5">•</span> {t}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => file && onAnalyze(file)}
          disabled={!file}
          className="w-full py-4 rounded-2xl font-bold text-black text-lg transition-all active:scale-95"
          style={{
            background: file ? "linear-gradient(135deg, #F59E0B, #D97706)" : "#ffffff20",
            color: file ? "#000" : "#fff4",
          }}
        >
          🔍 AI 선생님께 분석 요청하기
        </button>
      </div>
    </div>
  );
};

/** 분석 중 화면 */
const AnalyzingScreen = () => {
  const [step, setStep] = useState(0);
  const steps = [
    "🎵 연주 파일 불러오는 중...",
    "🔍 곡명 감지 중...",
    "🎼 음정 분석 중...",
    "⏱ 박자/리듬 분석 중...",
    "🔊 음색 & 셈여림 분석 중...",
    "✍️ AI 선생님 피드백 작성 중...",
  ];

  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: "linear-gradient(135deg, #0d0d1a, #1a1a2e)" }}
    >
      <MusicNotes />
      <div className="relative z-10 text-center w-full max-w-sm">
        {/* 회전 음표 */}
        <div className="relative w-24 h-24 mx-auto mb-8">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center text-4xl"
            style={{
              background: "linear-gradient(135deg, #F59E0B20, #F59E0B05)",
              border: "2px solid #F59E0B40",
              animation: "spin 3s linear infinite",
            }}
          >
            🎷
          </div>
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "2px solid transparent",
              borderTopColor: "#F59E0B",
              animation: "spin 1.5s linear infinite",
            }}
          />
        </div>

        <h2 className="text-white text-xl font-bold mb-2" style={{ fontFamily: "Georgia, serif" }}>
          분석하고 있어요
        </h2>
        <p className="text-white/50 text-sm mb-8">AI 선생님이 꼼꼼히 듣고 있습니다...</p>

        <div className="space-y-2.5">
          {steps.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all duration-500"
              style={{
                background: i <= step ? "#F59E0B10" : "#ffffff05",
                opacity: i <= step ? 1 : 0.3,
              }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: i < step ? "#34D399" : i === step ? "#F59E0B" : "#ffffff20" }}
              />
              <span className="text-sm" style={{ color: i <= step ? "#ffffffcc" : "#ffffff40" }}>
                {s}
              </span>
              {i === step && (
                <div className="ml-auto flex gap-0.5">
                  {[0, 1, 2].map((j) => (
                    <div
                      key={j}
                      className="w-1 h-1 rounded-full bg-amber-400"
                      style={{ animation: `bounce 0.6s ${j * 0.2}s infinite` }}
                    />
                  ))}
                </div>
              )}
              {i < step && <span className="ml-auto text-green-400 text-xs">✓</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** 피드백 화면 */
const FeedbackScreen = ({ feedback, user, onHome, onHistory }) => {
  const { detectedSong, scores, overall, praise, improvements, coachComment, nextGoal, encouragement } = feedback;

  const scoreItems = [
    { key: "intonation", label: "음정", color: "#60A5FA" },
    { key: "rhythm", label: "박자", color: "#34D399" },
    { key: "tone", label: "음색", color: "#F59E0B" },
    { key: "dynamics", label: "셈여림", color: "#F472B6" },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: "linear-gradient(180deg, #0d0d1a, #1a1a2e)" }}>
      <div className="px-5 pt-10">
        {/* 헤더 */}
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">👩‍🏫</div>
          <p className="text-amber-400 text-xs font-semibold">박지수 선생님의 피드백</p>
          <h2 className="text-white text-lg font-bold mt-1" style={{ fontFamily: "Georgia, serif" }}>
            {detectedSong !== "곡명 미상" ? `"${detectedSong}"` : "연주 분석 결과"}
          </h2>
          {detectedSong !== "곡명 미상" && (
            <div
              className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: "#34D39920", color: "#34D399" }}
            >
              🔍 곡 감지됨: {detectedSong}
            </div>
          )}
        </div>

        {/* 종합 점수 */}
        <div
          className="rounded-3xl p-6 mb-5 text-center"
          style={{ background: "linear-gradient(135deg, #F59E0B15, #F59E0B05)", border: "1px solid #F59E0B30" }}
        >
          <p className="text-white/50 text-xs mb-1">종합 점수</p>
          <p
            className="text-6xl font-bold mb-1"
            style={{ fontFamily: "Georgia, serif", color: "#F59E0B" }}
          >
            {overall}
          </p>
          <p className="text-white/40 text-sm">/ 100점</p>

          <div className="grid grid-cols-4 gap-3 mt-5">
            {scoreItems.map(({ key, label, color }) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <div
                  className="w-12 h-1.5 rounded-full"
                  style={{ background: `${color}30` }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${scores[key]}%`, background: color }}
                  />
                </div>
                <span style={{ color }} className="text-lg font-bold">{scores[key]}</span>
                <span className="text-white/40 text-xs">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 선생님 총평 */}
        <div
          className="rounded-3xl p-5 mb-4"
          style={{ background: "#ffffff05", border: "1px solid #ffffff10" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">💬</span>
            <p className="text-white/80 text-sm font-semibold">선생님 총평</p>
          </div>
          <p className="text-white/70 text-sm leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
            {coachComment}
          </p>
        </div>

        {/* 잘한 점 */}
        <div
          className="rounded-3xl p-5 mb-4"
          style={{ background: "#34D39908", border: "1px solid #34D39930" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">⭐</span>
            <p className="text-sm font-semibold" style={{ color: "#34D399" }}>잘한 점</p>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">{praise}</p>
        </div>

        {/* 개선점 */}
        <div
          className="rounded-3xl p-5 mb-4"
          style={{ background: "#F472B608", border: "1px solid #F472B630" }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📝</span>
            <p className="text-sm font-semibold" style={{ color: "#F472B6" }}>개선할 점</p>
          </div>
          <ul className="space-y-2">
            {(improvements || []).map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/70">
                <span style={{ color: "#F472B6" }} className="mt-0.5 flex-shrink-0">{i + 1}.</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* 다음 목표 */}
        <div
          className="rounded-3xl p-5 mb-5"
          style={{ background: "#60A5FA08", border: "1px solid #60A5FA30" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🎯</span>
            <p className="text-sm font-semibold" style={{ color: "#60A5FA" }}>다음 연습 목표</p>
          </div>
          <p className="text-white/70 text-sm">{nextGoal}</p>
        </div>

        {/* 격려 메시지 */}
        <div
          className="rounded-3xl p-5 mb-6 text-center"
          style={{ background: "linear-gradient(135deg, #F59E0B10, #D9770605)", border: "1px solid #F59E0B20" }}
        >
          <p className="text-amber-300 text-sm font-medium leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
            "{encouragement}"
          </p>
          <p className="text-white/30 text-xs mt-2">— 박지수 선생님</p>
        </div>

        {/* 하단 버튼 */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onHistory}
            className="py-4 rounded-2xl font-semibold text-sm transition-all active:scale-95"
            style={{ background: "#ffffff08", color: "#ffffffcc", border: "1px solid #ffffff15" }}
          >
            📋 기록 보기
          </button>
          <button
            onClick={onHome}
            className="py-4 rounded-2xl font-bold text-black text-sm transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #F59E0B, #D97706)" }}
          >
            🏠 홈으로
          </button>
        </div>
      </div>
    </div>
  );
};

/** 연주 기록 화면 */
const HistoryScreen = ({ history, onBack }) => {
  return (
    <div className="min-h-screen pb-24" style={{ background: "linear-gradient(180deg, #0d0d1a, #1a1a2e)" }}>
      <div className="px-5 pt-12">
        <button onClick={onBack} className="text-white/50 text-sm mb-6 flex items-center gap-1">← 뒤로</button>
        <h2 className="text-white text-xl font-bold mb-1" style={{ fontFamily: "Georgia, serif" }}>나의 연주 기록</h2>
        <p className="text-white/40 text-xs mb-6">총 {history.length}회 연주 기록</p>

        {/* 성장 그래프 */}
        {history.length >= 2 && (
          <div className="rounded-3xl p-5 mb-6" style={{ background: "#ffffff05", border: "1px solid #ffffff10" }}>
            <p className="text-white/70 text-sm font-semibold mb-4">📈 종합 점수 성장 그래프</p>
            <GrowthChart history={history} />
          </div>
        )}

        {/* 기록 목록 */}
        <div className="space-y-3">
          {[...history].reverse().map((record, i) => (
            <div
              key={record.id || i}
              className="rounded-2xl p-4"
              style={{ background: "#ffffff05", border: "1px solid #ffffff08" }}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-white/80 text-sm font-semibold">{record.song}</p>
                  <p className="text-white/30 text-xs">{record.date}</p>
                </div>
                <div
                  className="text-2xl font-bold px-3 py-1 rounded-xl"
                  style={{ background: "#F59E0B15", color: "#F59E0B", fontFamily: "Georgia, serif" }}
                >
                  {record.overall}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { key: "intonation", label: "음정", color: "#60A5FA" },
                  { key: "rhythm", label: "박자", color: "#34D399" },
                  { key: "tone", label: "음색", color: "#F59E0B" },
                  { key: "dynamics", label: "셈여림", color: "#F472B6" },
                ].map(({ key, label, color }) => (
                  <div key={key} className="text-center">
                    <div className="text-sm font-semibold" style={{ color }}>{record.scores[key]}</div>
                    <div className="text-white/30 text-xs">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/** FAQ 화면 */
const FAQScreen = ({ onBack }) => {
  const [open, setOpen] = useState(null);

  const faqs = [
    {
      q: "어떤 파일 형식을 지원하나요?",
      a: "MP4, MOV, AVI 등 일반적인 동영상 파일과 이미지 파일(JPG, PNG)을 지원합니다. 최대 100MB까지 업로드 가능합니다.",
    },
    {
      q: "AI가 어떤 기준으로 평가하나요?",
      a: "음정 정확도(Intonation), 박자/리듬감(Rhythm), 음색의 질(Tone), 셈여림(Dynamics) 4가지 항목을 분석합니다. 각 항목은 0-100점으로 평가됩니다.",
    },
    {
      q: "곡 감지는 어떻게 작동하나요?",
      a: "AI가 연주된 음악적 패턴, 음계, 리듬을 분석하여 곡을 추정합니다. 편곡이나 변주된 경우 정확도가 낮을 수 있습니다.",
    },
    {
      q: "나이와 성별 정보는 왜 필요한가요?",
      a: "AI 선생님이 학생의 연령과 성별에 맞는 적절한 언어와 격려 방식으로 피드백을 제공하기 위해 사용됩니다. 외부로 전송되지 않습니다.",
    },
    {
      q: "피드백이 마음에 안 들면 어떻게 하나요?",
      a: "AI 피드백은 참고 자료로 활용하세요. 실제 선생님의 지도를 병행하는 것이 가장 효과적입니다. 향후 업데이트를 통해 정확도를 개선해 나갈 예정입니다.",
    },
    {
      q: "다른 악기도 분석 가능한가요?",
      a: "현재는 클라리넷에 특화되어 있습니다. 향후 플룻, 오보에, 바이올린, 피아노 등 다양한 악기로 확장할 예정입니다.",
    },
  ];

  return (
    <div className="min-h-screen pb-24" style={{ background: "linear-gradient(180deg, #0d0d1a, #1a1a2e)" }}>
      <div className="px-5 pt-12">
        <button onClick={onBack} className="text-white/50 text-sm mb-6">← 뒤로</button>
        <h2 className="text-white text-xl font-bold mb-1" style={{ fontFamily: "Georgia, serif" }}>자주 묻는 질문</h2>
        <p className="text-white/40 text-xs mb-6">궁금한 점을 확인해보세요</p>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="rounded-2xl overflow-hidden cursor-pointer transition-all"
              style={{ background: "#ffffff05", border: `1px solid ${open === i ? "#F59E0B30" : "#ffffff08"}` }}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <div className="flex justify-between items-center px-5 py-4">
                <p className="text-white/80 text-sm font-medium pr-3">{faq.q}</p>
                <span className="text-amber-400 text-lg flex-shrink-0 transition-transform duration-300"
                  style={{ transform: open === i ? "rotate(45deg)" : "rotate(0deg)" }}>
                  +
                </span>
              </div>
              {open === i && (
                <div className="px-5 pb-4">
                  <div className="h-px mb-3" style={{ background: "#ffffff10" }} />
                  <p className="text-white/50 text-sm leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 향후 악기 확장 안내 */}
        <div className="mt-6 rounded-2xl p-5" style={{ background: "#60A5FA08", border: "1px solid #60A5FA20" }}>
          <p className="text-blue-300 text-xs font-semibold mb-2">🎸 향후 지원 예정 악기</p>
          <div className="flex flex-wrap gap-2">
            {["플룻 🎵", "오보에 🎷", "바이올린 🎻", "첼로 🎻", "피아노 🎹", "트럼펫 🎺", "호른 📯"].map((inst) => (
              <span
                key={inst}
                className="px-3 py-1 rounded-full text-xs"
                style={{ background: "#60A5FA15", color: "#60A5FA90" }}
              >
                {inst}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// 메인 앱
// ────────────────────────────────────────────────────────────────────────────────

export default function ClariCoachApp() {
  /** 현재 화면 */
  const [screen, setScreen] = useState(SCREENS.ONBOARDING);
  /** 사용자 정보 */
  const [user, setUser] = useState(null);
  /** 연습 기록 */
  const [history, setHistory] = useState(loadHistory);
  /** AI 피드백 결과 */
  const [feedback, setFeedback] = useState(null);
  /** 오류 메시지 */
  const [error, setError] = useState(null);

  /** 프로필 저장 핸들러 */
  const handleSaveProfile = useCallback((profile) => {
    setUser(profile);
    setScreen(SCREENS.HOME);
  }, []);

  /** 영상 분석 핸들러 */
  const handleAnalyze = useCallback(
    async (file) => {
      setScreen(SCREENS.ANALYZING);
      setError(null);
      try {
        const result = await analyzePerformance(file, user.age, user.gender, user.apiKey);
        setFeedback(result);

        // 기록 추가
        const newRecord = {
          id: Date.now(),
          date: new Date().toISOString().split("T")[0],
          song: result.detectedSong || "제목 미상",
          scores: result.scores,
          overall: result.overall,
        };
        const updated = [...history, newRecord];
        setHistory(updated);
        saveHistory(updated);

        setScreen(SCREENS.FEEDBACK);
      } catch (err) {
        setError(`분석 중 오류가 발생했습니다: ${err.message}`);
        setScreen(SCREENS.UPLOAD);
      }
    },
    [user, history]
  );

  return (
    <>
      {/* 전역 CSS */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.15; }
          50% { transform: translateY(-20px) rotate(10deg); opacity: 0.3; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-float { animation: float 4s ease-in-out infinite; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>

      <div className="max-w-md mx-auto relative">
        {/* 오류 토스트 */}
        {error && (
          <div
            className="fixed top-4 left-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium text-white shadow-xl"
            style={{ transform: "translateX(-50%)", background: "#ef444490", backdropFilter: "blur(10px)", maxWidth: "calc(100vw - 2rem)" }}
            onClick={() => setError(null)}
          >
            ⚠️ {error}
          </div>
        )}

        {/* 화면 라우팅 */}
        {screen === SCREENS.ONBOARDING && (
          <OnboardingScreen onComplete={() => setScreen(SCREENS.PROFILE)} />
        )}
        {screen === SCREENS.PROFILE && (
          <ProfileScreen onSave={handleSaveProfile} />
        )}
        {screen === SCREENS.HOME && user && (
          <HomeScreen user={user} history={history} onNavigate={setScreen} />
        )}
        {screen === SCREENS.UPLOAD && user && (
          <UploadScreen user={user} onAnalyze={handleAnalyze} onBack={() => setScreen(SCREENS.HOME)} />
        )}
        {screen === SCREENS.ANALYZING && <AnalyzingScreen />}
        {screen === SCREENS.FEEDBACK && feedback && (
          <FeedbackScreen
            feedback={feedback}
            user={user}
            onHome={() => setScreen(SCREENS.HOME)}
            onHistory={() => setScreen(SCREENS.HISTORY)}
          />
        )}
        {screen === SCREENS.HISTORY && (
          <HistoryScreen history={history} onBack={() => setScreen(SCREENS.HOME)} />
        )}
        {screen === SCREENS.FAQ && (
          <FAQScreen onBack={() => setScreen(SCREENS.HOME)} />
        )}

        {/* 하단 네비게이션 (홈 이후 화면에서 표시) */}
        {user && ![SCREENS.ONBOARDING, SCREENS.PROFILE, SCREENS.ANALYZING].includes(screen) && (
          <nav
            className="fixed bottom-0 left-1/2 w-full max-w-md flex items-center justify-around px-6 py-3"
            style={{
              transform: "translateX(-50%)",
              background: "rgba(13,13,26,0.95)",
              backdropFilter: "blur(20px)",
              borderTop: "1px solid #ffffff10",
            }}
          >
            {[
              { icon: "🏠", label: "홈", target: SCREENS.HOME },
              { icon: "🎬", label: "업로드", target: SCREENS.UPLOAD },
              { icon: "📋", label: "기록", target: SCREENS.HISTORY },
              { icon: "❓", label: "FAQ", target: SCREENS.FAQ },
            ].map(({ icon, label, target }) => (
              <button
                key={target}
                onClick={() => setScreen(target)}
                className="flex flex-col items-center gap-0.5 py-1 px-3 rounded-xl transition-all"
                style={{ color: screen === target ? "#F59E0B" : "#ffffff40" }}
              >
                <span className="text-xl">{icon}</span>
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
