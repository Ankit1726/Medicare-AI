const $ = (id) => document.getElementById(id);
let history = [],
  imageData = null,
  recorder = null,
  audioChunks = [],
  cameraStream = null,
  lastAnswer = "";

const WELCOME =
  "Hello! Ask a medical question, upload an image, or use the microphone. I'll cite available sources and explain uncertainty.";
const MIC_IDLE = "🎤 <span>Voice</span>";
const MIC_REC = "⏹ <span>Stop</span>";

const headers = () => {
  const h = {};
  const tokenField = $("token");
  const token = tokenField ? tokenField.value.trim() : "";
  if (token) h.Authorization = "Bearer " + token;
  return h;
};

function safeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sourcesText(sources = []) {
  const items = (sources || [])
    .slice(0, 8)
    .map((x) => {
      if (!x) return null;
      if (x.type === "pdf") return x.page ? `PDF page ${x.page}` : "PDF source";
      if (x.url) return x.url;
      if (x.title) return x.title;
      return "Source";
    })
    .filter(Boolean);
  return items.length ? "Sources: " + items.join(" | ") : "";
}

function renderStructuredReply(container, text, sources = []) {
  const value = safeText(text || "");
  const parts = value ? value.split(/\n\s*\n+/).filter(Boolean) : ["I’m ready to help."];

  container.innerHTML = "";
  parts.forEach((part) => {
    const p = document.createElement("p");
    p.textContent = part.trim();
    container.appendChild(p);
  });

  if (sources.length) {
    const s = document.createElement("div");
    s.className = "sources";
    s.textContent = sourcesText(sources);
    container.appendChild(s);
  }
}

function bubble(text, kind = "bot", sources = []) {
  const el = document.createElement("article");
  el.className = kind;

  if (kind === "bot" && typeof text === "string" && text.includes("\n")) {
    renderStructuredReply(el, text, sources);
  } else {
    const clean = safeText(text || "");
    el.textContent = clean || "I’m ready to help.";
    if (sources.length) {
      const s = document.createElement("div");
      s.className = "sources";
      s.textContent = sourcesText(sources);
      el.appendChild(s);
    }
  }

  $("messages").appendChild(el);
  $("messages").scrollTop = $("messages").scrollHeight;
  return el;
}

function typingBubble() {
  const el = bubble("");
  el.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  return el;
}

function setStatus(text, cls) {
  const s = $("status");
  if (!s) return;
  s.textContent = text;
  s.className = "status " + cls;
}

async function check() {
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    const pineconeName = $("pineconeName");
    const pineconeDimension = $("pineconeDimension");
    if (pineconeName) pineconeName.textContent = d.pinecone_index || "medical-agent";
    if (pineconeDimension) pineconeDimension.textContent = d.pinecone_dimension || 384;
    const missing = d.missing || [];
    if (missing.includes("PINECONE_API_KEY")) {
      setStatus("⚠ Knowledge base unavailable", "warn");
    } else if (missing.includes("GROQ_API_KEY")) {
      setStatus("Add your Groq key for chat", "warn");
    } else if (missing.length) {
      setStatus("⚠ Missing: " + missing.join(", "), "warn");
    } else {
      setStatus("Keys configured · services not verified", "warn");
    }
  } catch {
    setStatus("● Server offline", "off");
  }
}

function personalGroqCredentials() {
  const apiKey = $("groqApiKey")?.value.trim();
  const model = $("groqModel")?.value.trim();
  if (!apiKey) return null;
  if (!model) throw new Error("Enter a Groq model ID for your API key.");
  return { groq_api_key: apiKey, groq_model: model };
}

function providerStatus(message, kind = "") {
  const status = $("providerStatus");
  if (!status) return;
  status.textContent = message;
  status.className = kind;
}

$("testGroq")?.addEventListener("click", async () => {
  const button = $("testGroq");
  try {
    const credentials = personalGroqCredentials();
    if (!credentials) throw new Error("Enter your Groq API key first.");
    button.disabled = true;
    providerStatus("Checking key and model…");
    const r = await fetch("/api/provider/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: credentials.groq_api_key, model: credentials.groq_model }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.detail || "Could not verify key and model.");
    providerStatus("✓ Key and model are working.", "ok");
  } catch (err) {
    providerStatus(err?.message || "Could not verify key and model.", "err");
  } finally {
    button.disabled = false;
  }
});

$("providerShortcut")?.addEventListener("click", () => {
  const settings = $("providerSettings");
  if (!settings) return;
  settings.open = true;
  settings.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center",
  });
  $("groqApiKey")?.focus({ preventScroll: true });
});

["groqApiKey", "groqModel"].forEach((id) =>
  $(id)?.addEventListener("input", () => providerStatus(""))
);

check();
setInterval(check, 30000);

function setImage(file) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5e6) {
    alert("Use PNG/JPEG/WebP under 5MB");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    imageData = reader.result;
    const thumb = $("thumbnail");
    const preview = $("preview");
    if (thumb) thumb.src = imageData;
    if (preview) preview.hidden = false;
  };
  reader.readAsDataURL(file);
}

$("image")?.addEventListener("change", (e) => setImage(e.target.files[0]));
$("remove")?.addEventListener("click", () => {
  imageData = null;
  const preview = $("preview");
  if (preview) preview.hidden = true;
  const input = $("image");
  if (input) input.value = "";
});

document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    const message = $("message");
    if (!message) return;
    message.value = c.dataset.prompt || "";
    message.focus();
  })
);

$("clear")?.addEventListener("click", () => {
  history = [];
  lastAnswer = "";
  $("messages").innerHTML = "";
  bubble(WELCOME);
});

$("message")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chatForm")?.requestSubmit();
  }
});

$("chatForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = $("message")?.value?.trim();
  if (!message) return;

  const prior = history.slice(-8);
  let credentials;
  try {
    credentials = personalGroqCredentials();
  } catch (err) {
    bubble(err.message, "bot");
    return;
  }
  bubble(message, "user");
  $("message").value = "";
  $("send").disabled = true;
  const pending = typingBubble();

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: prior, image_data: imageData, ...credentials }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "Request failed");

    renderStructuredReply(pending, d.answer || "I’m ready to help.", d.sources || []);
    lastAnswer = d.answer || "";
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: d.answer || "" }
    );
    $("remove")?.click();
  } catch (err) {
    pending.textContent = "Error: " + (err?.message || "Request failed");
  } finally {
    $("send").disabled = false;
    $("messages").scrollTop = $("messages").scrollHeight;
  }
});

$("mic")?.addEventListener("click", async () => {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => audioChunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      $("mic")?.classList.remove("rec");
      $("mic").innerHTML = MIC_IDLE;

      const blob = new Blob(audioChunks, { type: recorder.mimeType || "audio/webm" });
      const data = new FormData();
      data.append("file", blob, "voice.webm");
      const personalKey = $("groqApiKey")?.value.trim();
      if (personalKey) data.append("groq_api_key", personalKey);
      $("mic").disabled = true;

      try {
        const r = await fetch("/api/transcribe", {
          method: "POST",
          headers: headers(),
          body: data,
        });
        const out = await r.json();
        if (!r.ok) throw Error(out.detail || "Voice transcription failed");
        const message = $("message");
        if (message) message.value = out.text || "";
      } catch (e) {
        alert(e.message || "Microphone transcription failed");
      } finally {
        $("mic").disabled = false;
      }
    };

    recorder.start();
    $("mic")?.classList.add("rec");
    $("mic").innerHTML = MIC_REC;
  } catch (e) {
    alert("Microphone unavailable: " + (e.message || "unknown error"));
  }
});

$("listen")?.addEventListener("click", () => {
  if (!lastAnswer) return alert("Ask a question first");
  if (!("speechSynthesis" in window)) return alert("Speech not supported in this browser");
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    return;
  }
  speechSynthesis.speak(new SpeechSynthesisUtterance(lastAnswer));
});

$("camera")?.addEventListener("click", async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    const video = $("video");
    if (video) {
      video.srcObject = cameraStream;
      video.hidden = false;
    }
    const cameraActions = $("cameraActions");
    if (cameraActions) cameraActions.hidden = false;
  } catch (e) {
    alert("Camera unavailable: " + (e.message || "unknown error"));
  }
});

$("closeCamera")?.addEventListener("click", () => {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  const video = $("video");
  if (video) video.hidden = true;
  const cameraActions = $("cameraActions");
  if (cameraActions) cameraActions.hidden = true;
});

$("snap")?.addEventListener("click", () => {
  const v = $("video");
  const c = $("canvas");
  if (!v || !c) return;
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(v, 0, 0);
  c.toBlob(
    (b) => {
      if (b) setImage(new File([b], "camera.jpg", { type: "image/jpeg" }));
    },
    "image/jpeg",
    0.85
  );
  $("closeCamera")?.click();
});

$("kbfile")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const st = $("kbstatus");
  if (st) {
    st.className = "busy";
    st.textContent = `Indexing ${file.name} — large files can take a minute`;
  }

  const data = new FormData();
  data.append("file", file);

  try {
    const r = await fetch("/api/ingest", {
      method: "POST",
      headers: headers(),
      body: data,
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out.detail || "Upload failed");
    if (st) {
      st.className = "ok";
      st.textContent = `✓ ${out.file} added (${out.chunks} chunks). You can ask about it now.`;
    }
  } catch (err) {
    if (st) {
      st.className = "err";
      st.textContent = "Error: " + (err?.message || "Upload failed");
    }
  } finally {
    e.target.value = "";
  }
});
