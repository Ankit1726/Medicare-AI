const $ = (id) => document.getElementById(id);
let history = [],
  imageData = null,
  recorder = null,
  audioChunks = [],
  cameraStream = null,
  lastAnswer = "",
  liveVerification = "";

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

function appendInlineText(container, text) {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  segments.forEach((segment) => {
    const match = segment.match(/^\*\*(.+)\*\*$/);
    if (!match) {
      container.appendChild(document.createTextNode(segment));
      return;
    }
    const strong = document.createElement("strong");
    strong.textContent = match[1];
    container.appendChild(strong);
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function reportAnswerHTML(text) {
  const content = document.createElement("div");
  renderStructuredReply(content, text);
  return content.innerHTML || "<p>No assistant response was recorded.</p>";
}

function reportSourcesHTML(sources) {
  const links = (sources || []).slice(0, 8).map((source) => {
    if (!source) return "";
    if (source.type === "pdf") {
      return `<li>${escapeHTML(source.page ? `PDF page ${source.page}` : "PDF source")}</li>`;
    }
    if (typeof source.url !== "string") {
      return source.title ? `<li>${escapeHTML(source.title)}</li>` : "";
    }
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      const label = source.title || url.href;
      return `<li><a href="${escapeHTML(url.href)}" rel="noreferrer">${escapeHTML(label)}</a></li>`;
    } catch {
      return "";
    }
  }).filter(Boolean);
  return links.length ? `<ul>${links.join("")}</ul>` : "<p>No sources were attached to this response.</p>";
}

function doctorReportHTML(question, answer, sources) {
  const answerMarkup = reportAnswerHTML(answer);
  const sourceMarkup = reportSourcesHTML(sources);
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Doctor visit preparation report</title>
<style>
  *{box-sizing:border-box}body{max-width:820px;margin:0 auto;padding:36px 28px;color:#182321;font:15px/1.6 Arial,sans-serif}
  header{padding-bottom:18px;border-bottom:2px solid #d5e4dc}h1{margin:0;font-size:26px;letter-spacing:-.03em}
  h2{margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #dce5df;color:#1b5b4b;font-size:18px}
  h3{margin:18px 0 6px;color:#1b5b4b;font-size:15px}p{margin:8px 0}li{margin:4px 0}
  .meta,.disclaimer,.patient-report{padding:14px 16px;border-radius:10px;background:#f2f6f3}
  .disclaimer{margin-top:16px;border-left:4px solid #c38a32;font-size:13px}
  .patient-report{white-space:pre-wrap;overflow-wrap:anywhere}
  .field{margin:13px 0}.line{display:block;min-height:26px;margin-top:3px;border-bottom:1px solid #aebbb4}
  a{color:#176b59;overflow-wrap:anywhere}.actions{display:flex;gap:10px;margin:22px 0}
  button{padding:10px 15px;border:0;border-radius:8px;background:#176b59;color:white;font-size:14px;cursor:pointer}
  .small{color:#596a62;font-size:12px}
  @media print{body{padding:0;font-size:11pt}h2{break-after:avoid}.actions{display:none}.patient-report{background:white;padding:0}.disclaimer{background:white}}
  @media(max-width:560px){body{padding:20px 16px}}
</style>
</head>
<body>
<header><p class="small">CARE · HEALTH VISIT PREPARATION</p><h1>Doctor visit preparation report</h1><p class="small">Prepared ${escapeHTML(date)} · Patient-reported information and AI-generated educational context</p></header>
<div class="disclaimer"><strong>For clinician review:</strong> This report is a visit-preparation aid, not a medical record, verified history, diagnosis, or prescription. The AI-generated content is not clinician-verified. Please confirm all details directly with the patient and make all examination, diagnosis, and treatment decisions.</div>
<h2>1. Reason for visit — patient’s own words</h2><div class="patient-report">${escapeHTML(question)}</div>
<h2>2. Details to confirm with the patient</h2>
<div class="field"><strong>When it started and duration</strong><span class="line"></span></div>
<div class="field"><strong>How symptoms have changed; frequency and severity (if relevant)</strong><span class="line"></span></div>
<div class="field"><strong>Location, associated symptoms, triggers, and anything that helps</strong><span class="line"></span></div>
<div class="field"><strong>Temperature or other measurements, if available</strong><span class="line"></span></div>
<div class="field"><strong>Relevant medical conditions and recent health changes</strong><span class="line"></span></div>
<div class="field"><strong>Current medicines/supplements (include strength and when last taken, if known)</strong><span class="line"></span></div>
<div class="field"><strong>Allergies or previous medication reactions</strong><span class="line"></span></div>
<div class="field"><strong>What the patient has tried and the effect</strong><span class="line"></span></div>
<div class="field"><strong>Patient’s questions or concerns</strong><span class="line"></span></div>
<h2>3. AI-generated educational response — unverified</h2><div class="ai-response">${answerMarkup}</div>
<h2>4. Sources attached to the response</h2>${sourceMarkup}
<h2>5. Clinician assessment and plan</h2>
<div class="field"><strong>Clinician’s assessment / examination notes</strong><span class="line"></span><span class="line"></span></div>
<div class="field"><strong>Tests, diagnosis, treatment, and follow-up — clinician to complete</strong><span class="line"></span><span class="line"></span></div>
<p class="small">Generated locally from this conversation; this export is not sent to or stored by the report feature. Share only with the patient’s consent. This document may contain sensitive health information.</p>
<div class="actions"><button type="button" onclick="window.print()">Print / save as PDF</button></div>
</body>
</html>`;
}

function openDoctorReport(question, answer, sources) {
  const html = doctorReportHTML(question, answer, sources);
  const reportWindow = window.open("about:blank", "_blank");
  if (!reportWindow) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const link = document.createElement("a");
    const reportURL = URL.createObjectURL(blob);
    link.href = reportURL;
    link.download = `care-doctor-visit-report-${new Date().toISOString().slice(0, 10)}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(reportURL), 60_000);
    return false;
  }
  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  return true;
}

function renderStructuredReply(container, text, sources = [], question = "") {
  const value = safeText(text || "");
  container.innerHTML = "";
  let list = null;
  value.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      list = null;
      return;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      list = null;
      const title = document.createElement("h3");
      appendInlineText(title, heading[1].replace(/\*\*/g, ""));
      container.appendChild(title);
      return;
    }
    const bullet = line.match(/^(?:[-*]\s+|\d+[.)]\s+)(.+)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        container.appendChild(list);
      }
      const item = document.createElement("li");
      appendInlineText(item, bullet[1]);
      list.appendChild(item);
      return;
    }
    list = null;
    const paragraph = document.createElement("p");
    appendInlineText(paragraph, line.replace(/\*\*/g, ""));
    container.appendChild(paragraph);
  });

  if (sources.length) {
    const s = document.createElement("div");
    s.className = "sources";
    s.textContent = sourcesText(sources);
    container.appendChild(s);
  }

  if (question) {
    const copyButton = document.createElement("button");
    copyButton.className = "copy-doctor-note";
    copyButton.type = "button";
    copyButton.textContent = "Copy doctor visit note";
    copyButton.setAttribute("aria-label", "Copy a summary of your reported concern for your clinician");
    copyButton.addEventListener("click", async () => {
      const note = [
        "Doctor visit note — patient-reported; please review",
        "",
        `Reason for visit (my words): ${question}`,
        "When it started / duration: Please fill in",
        "Relevant medical conditions: Please fill in",
        "Current medicines and supplements: Please fill in",
        "Allergies or medication reactions: Please fill in",
        "Questions for the clinician: What evaluation or care do you recommend?",
        "Medication or prescription decisions: For clinician review",
      ].join("\n");
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard access is unavailable in this browser.");
        }
        await navigator.clipboard.writeText(note);
        copyButton.textContent = "Doctor note copied ✓";
        copyButton.setAttribute("aria-label", "Doctor visit note copied");
      } catch {
        copyButton.textContent = "Copy unavailable — select text manually";
        copyButton.setAttribute("aria-label", "Clipboard unavailable; select and copy text manually");
      }
    });
    const actions = document.createElement("div");
    actions.className = "reply-actions";
    actions.appendChild(copyButton);
    const exportButton = document.createElement("button");
    exportButton.className = "export-doctor-report";
    exportButton.type = "button";
    exportButton.textContent = "Export doctor visit report";
    exportButton.addEventListener("click", () => {
      try {
        const opened = openDoctorReport(question, value, sources);
        exportButton.textContent = opened
          ? "Report ready · print or save as PDF"
          : "Report downloaded · open to print";
      } catch {
        exportButton.textContent = "Report export failed — try again";
      }
    });
    actions.appendChild(exportButton);
    container.appendChild(actions);
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
    if (!r.ok) throw new Error("Health check failed");
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
    } else if (liveVerification) {
      setStatus(liveVerification, "ok");
    } else {
      setStatus("Keys configured · services not verified", "warn");
    }
  } catch {
    liveVerification = "";
    setStatus("● Server offline", "off");
  }
}

function markLiveReady(message) {
  liveVerification = message;
  setStatus(message, "ok");
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
    markLiveReady("✓ Groq live · key and model verified");
  } catch (err) {
    liveVerification = "";
    setStatus("⚠ Groq key/model test failed", "warn");
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
  $("message").value = "";
  $("remove")?.click();
  $("emptyState").hidden = false;
  $("message").focus();
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
    $("emptyState").hidden = true;
    bubble(err.message, "bot");
    return;
  }
  $("emptyState").hidden = true;
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

    renderStructuredReply(pending, d.answer || "I’m ready to help.", d.sources || [], message);
    lastAnswer = d.answer || "";
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: d.answer || "" }
    );
    markLiveReady("✓ Live chat verified · AI ready");
    $("remove")?.click();
  } catch (err) {
    liveVerification = "";
    setStatus("⚠ Live chat failed", "warn");
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
