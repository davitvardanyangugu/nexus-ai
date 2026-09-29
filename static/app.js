const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "alenaz_conversations_v1";
const SETTINGS_KEY = "alenaz_settings_v1";

let conversations = loadJSON(STORAGE_KEY, []);
let currentId = null;
let currentAttachment = null;
let activeTool = null;
let sending = false;
let health = null;

let settings = Object.assign({
  displayName: "Guest",
  speak: false,
  compact: false,
  theme: "dark"
}, loadJSON(SETTINGS_KEY, {}));

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Could not save local Alenaz data:", error);
  }
}

function safeConversationsForStorage() {
  return conversations.map(function (conversation) {
    return Object.assign({}, conversation, {
      messages: conversation.messages.map(function (message) {
        const copy = Object.assign({}, message);
        if (copy.image && copy.image.indexOf("data:") === 0) {
          delete copy.image;
          copy.imageExpired = true;
        }
        return copy;
      })
    });
  });
}

function saveConversations() {
  saveJSON(STORAGE_KEY, safeConversationsForStorage());
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function currentConversation() {
  return conversations.find(function (item) {
    return item.id === currentId;
  }) || null;
}

function ensureConversation() {
  let conversation = currentConversation();
  if (conversation) return conversation;

  conversation = {
    id: uid(),
    title: "New chat",
    created: Date.now(),
    updated: Date.now(),
    messages: []
  };

  conversations.unshift(conversation);
  currentId = conversation.id;
  saveConversations();
  renderHistory();
  return conversation;
}

function newChat() {
  currentId = null;
  currentAttachment = null;
  setTool(null);
  updateAttachmentUI();
  $("promptInput").value = "";
  resizeTextarea();
  renderConversation();
  closeSidebarOnMobile();
}

function loadConversation(id) {
  currentId = id;
  currentAttachment = null;
  setTool(null);
  updateAttachmentUI();
  renderHistory();
  renderConversation();
  closeSidebarOnMobile();
}

function updateTitle(conversation) {
  if (!conversation || conversation.title !== "New chat") return;
  const firstUser = conversation.messages.find(function (message) {
    return message.role === "user" && message.text;
  });
  if (!firstUser) return;

  let title = firstUser.text.replace(/\s+/g, " ").trim();
  if (title.length > 34) title = title.slice(0, 34) + "…";
  conversation.title = title || "New chat";
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";

  const ordered = conversations.slice().sort(function (a, b) {
    return (b.updated || 0) - (a.updated || 0);
  });

  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.textContent = "Your conversations will appear here.";
    list.appendChild(empty);
    return;
  }

  ordered.forEach(function (conversation) {
    const button = document.createElement("button");
    button.className = "history-item" + (conversation.id === currentId ? " active" : "");
    button.textContent = conversation.title || "New chat";
    button.title = conversation.title || "New chat";
    button.addEventListener("click", function () {
      loadConversation(conversation.id);
    });
    list.appendChild(button);
  });
}

function renderConversation() {
  const messages = $("messages");
  const welcome = $("welcome");
  messages.innerHTML = "";

  const conversation = currentConversation();
  if (!conversation || !conversation.messages.length) {
    welcome.classList.remove("hidden");
    return;
  }

  welcome.classList.add("hidden");
  conversation.messages.forEach(function (message) {
    messages.appendChild(createMessageElement(message));
  });

  scrollConversation();
}

function createMessageElement(message) {
  const row = document.createElement("div");
  row.className = "message " + message.role;

  if (message.role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "A";
    row.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "message-body";

  if (message.text) {
    const text = document.createElement("div");
    text.className = "message-text";

    if (message.role === "assistant" && Array.isArray(message.sources) && message.sources.length) {
      renderCitedText(text, message.text, message.sources);
    } else {
      text.textContent = message.text;
    }

    body.appendChild(text);
  }

  if (message.attachmentName) {
    const file = document.createElement("div");
    file.className = "message-file";
    file.textContent = "Attachment · " + message.attachmentName;
    body.appendChild(file);
  }

  if (message.image) {
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = message.image;
    image.alt = message.imageAlt || "Image generated by Alenaz";
    body.appendChild(image);
  } else if (message.imageExpired) {
    const expired = document.createElement("div");
    expired.className = "message-file";
    expired.textContent = "Generated image was not saved in browser history.";
    body.appendChild(expired);
  }

  if (message.role === "assistant" && Array.isArray(message.sources) && message.sources.length) {
    const sourceRow = document.createElement("div");
    sourceRow.className = "source-row";

    message.sources.slice(0, 8).forEach(function (source, index) {
      if (!source.url) return;
      const link = document.createElement("a");
      link.className = "source-chip";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = (index + 1) + " · " + (source.title || source.url);
      sourceRow.appendChild(link);
    });

    body.appendChild(sourceRow);
  }

  row.appendChild(body);
  return row;
}

function renderCitedText(container, text, sources) {
  const usable = sources
    .filter(function (source) {
      return source.url && Number.isInteger(source.end_index);
    })
    .slice()
    .sort(function (a, b) {
      return a.end_index - b.end_index;
    });

  if (!usable.length) {
    container.textContent = text;
    return;
  }

  let cursor = 0;
  usable.forEach(function (source, index) {
    const end = Math.max(cursor, Math.min(text.length, source.end_index));
    if (end > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, end)));
    }

    const citation = document.createElement("a");
    citation.className = "citation-link";
    citation.href = source.url;
    citation.target = "_blank";
    citation.rel = "noopener noreferrer";
    citation.title = source.title || source.url;
    citation.textContent = String(index + 1);
    container.appendChild(citation);

    cursor = end;
  });

  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function addLiveAssistant() {
  $("welcome").classList.add("hidden");

  const row = document.createElement("div");
  row.className = "message assistant";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "A";

  const body = document.createElement("div");
  body.className = "message-body";

  const text = document.createElement("div");
  text.className = "message-text";

  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.innerHTML = "<span></span><span></span><span></span>";
  text.appendChild(thinking);

  body.appendChild(text);
  row.appendChild(avatar);
  row.appendChild(body);
  $("messages").appendChild(row);
  scrollConversation();

  return { row: row, body: body, text: text, thinking: thinking };
}

function scrollConversation() {
  const conversation = document.querySelector(".conversation");
  requestAnimationFrame(function () {
    conversation.scrollTop = conversation.scrollHeight;
  });
}

function setTool(tool) {
  activeTool = tool;
  const banner = $("modeBanner");
  const searchToggle = $("searchToggle");

  searchToggle.classList.toggle("active", tool === "search");
  searchToggle.setAttribute("aria-pressed", tool === "search" ? "true" : "false");

  if (!tool) {
    banner.classList.add("hidden");
    $("promptInput").placeholder = "Message Alenaz";
    return;
  }

  banner.classList.remove("hidden");

  if (tool === "search") {
    $("modeBannerIcon").textContent = "⌕";
    $("modeBannerText").textContent = "Web search enabled for your next message";
    $("promptInput").placeholder = "Search with Alenaz";
  } else if (tool === "image") {
    $("modeBannerIcon").textContent = "✦";
    $("modeBannerText").textContent = "Image creation enabled for your next message";
    $("promptInput").placeholder = "Describe the image you want";
  }

  $("promptInput").focus();
}

function getHistoryForRequest(conversation) {
  return conversation.messages
    .filter(function (message) {
      return (message.role === "user" || message.role === "assistant") && message.text;
    })
    .slice(-12)
    .map(function (message) {
      return { role: message.role, text: message.text };
    });
}

async function sendMessage() {
  if (sending) return;

  const input = $("promptInput");
  const text = input.value.trim();

  if (!text && !currentAttachment) return;

  if (activeTool === "image" && !text) {
    showNotice("Describe the image you want Alenaz to create.");
    return;
  }

  const conversation = ensureConversation();
  const requestHistory = getHistoryForRequest(conversation);
  const attachmentForRequest = currentAttachment;
  const toolForRequest = activeTool;

  const userText = text || "Please analyze this attachment.";
  const userMessage = {
    role: "user",
    text: userText,
    attachmentName: attachmentForRequest ? attachmentForRequest.name : null
  };

  conversation.messages.push(userMessage);
  conversation.updated = Date.now();
  updateTitle(conversation);
  saveConversations();
  renderHistory();

  $("welcome").classList.add("hidden");
  $("messages").appendChild(createMessageElement(userMessage));
  scrollConversation();

  input.value = "";
  currentAttachment = null;
  updateAttachmentUI();
  resizeTextarea();
  setTool(null);
  setSending(true);

  const payload = {
    message: userText,
    history: requestHistory,
    mode: $("modeSelect").value,
    attachment: attachmentForRequest
  };

  try {
    if (toolForRequest === "search") {
      await sendSearch(conversation, payload);
    } else if (toolForRequest === "image") {
      await sendImage(conversation, userText);
    } else {
      await sendStream(conversation, payload);
    }
  } catch (error) {
    const errorMessage = {
      role: "assistant",
      text: "I hit an error: " + error.message
    };
    conversation.messages.push(errorMessage);
    conversation.updated = Date.now();
    $("messages").appendChild(createMessageElement(errorMessage));
    saveConversations();
    scrollConversation();
  } finally {
    setSending(false);
  }
}

async function sendStream(conversation, payload) {
  const live = addLiveAssistant();

  const response = await fetch("/api/chat_stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    live.row.remove();
    throw new Error(await responseError(response));
  }

  if (!response.body) {
    live.row.remove();
    throw new Error("Streaming is not available in this browser.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";
  let started = false;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    if (!started) {
      live.text.innerHTML = "";
      started = true;
    }

    answer += decoder.decode(chunk.value, { stream: true });
    live.text.textContent = answer;
    scrollConversation();
  }

  answer += decoder.decode();

  if (!started) {
    live.text.innerHTML = "";
    live.text.textContent = answer || "No response received.";
  }

  const assistantMessage = {
    role: "assistant",
    text: answer || "No response received."
  };

  conversation.messages.push(assistantMessage);
  conversation.updated = Date.now();
  saveConversations();
  speakIfEnabled(assistantMessage.text);
}

async function sendSearch(conversation, payload) {
  const live = addLiveAssistant();

  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    live.row.remove();
    throw new Error(await responseError(response));
  }

  const data = await response.json();
  live.row.remove();

  const assistantMessage = {
    role: "assistant",
    text: data.answer || "No search answer received.",
    sources: Array.isArray(data.sources) ? data.sources : []
  };

  conversation.messages.push(assistantMessage);
  conversation.updated = Date.now();
  saveConversations();

  $("messages").appendChild(createMessageElement(assistantMessage));
  scrollConversation();
  speakIfEnabled(assistantMessage.text);
}

async function sendImage(conversation, prompt) {
  const live = addLiveAssistant();

  const response = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt })
  });

  if (!response.ok) {
    live.row.remove();
    throw new Error(await responseError(response));
  }

  const data = await response.json();
  live.row.remove();

  const assistantMessage = {
    role: "assistant",
    text: "Here is the image I created from your prompt.",
    image: data.image,
    imageAlt: prompt
  };

  conversation.messages.push(assistantMessage);
  conversation.updated = Date.now();
  saveConversations();

  $("messages").appendChild(createMessageElement(assistantMessage));
  scrollConversation();
}

async function responseError(response) {
  try {
    const data = await response.json();
    if (data && data.error) {
      if (data.retry_after) {
        return data.error + " Try again in about " + formatDuration(data.retry_after) + ".";
      }
      return data.error;
    }
  } catch (error) {
    // Fall through to status text.
  }
  return response.statusText || "Request failed.";
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return minutes + " minute" + (minutes === 1 ? "" : "s");
  const hours = Math.ceil(minutes / 60);
  return hours + " hour" + (hours === 1 ? "" : "s");
}

function setSending(value) {
  sending = value;
  $("sendButton").disabled = value;
  $("voiceButton").disabled = value;
}

function resizeTextarea() {
  const input = $("promptInput");
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}

function showNotice(message) {
  const notice = $("apiNotice");
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function hideNotice() {
  $("apiNotice").classList.add("hidden");
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    health = await response.json();

    $("modelName").textContent = health.chat_model || "AI";
    $("usagePill").textContent =
      (health.hourly_limit || 30) + " msgs/hour · " +
      (health.image_daily_limit || 3) + " images/day";

    if (!health.configured) {
      showNotice("Alenaz is ready, but the server needs an OPENAI_API_KEY environment variable before AI features can answer.");
    } else {
      hideNotice();
    }
  } catch (error) {
    $("modelName").textContent = "offline";
    showNotice("Alenaz could not reach its backend.");
  }
}

function updateAttachmentUI() {
  const preview = $("attachmentPreview");

  if (!currentAttachment) {
    preview.classList.add("hidden");
    $("attachmentThumb").style.backgroundImage = "";
    $("attachmentThumb").textContent = "FILE";
    return;
  }

  preview.classList.remove("hidden");
  $("attachmentName").textContent = currentAttachment.name;
  $("attachmentType").textContent = currentAttachment.type || "file";

  const thumb = $("attachmentThumb");
  if ((currentAttachment.type || "").indexOf("image/") === 0) {
    thumb.textContent = "";
    thumb.style.backgroundImage = "url(" + JSON.stringify(currentAttachment.data).slice(1, -1) + ")";
  } else {
    thumb.style.backgroundImage = "";
    thumb.textContent = "FILE";
  }
}

function fileToDataURL(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      resolve(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file) return;

  if (file.size > 8 * 1024 * 1024) {
    showNotice("For this prototype, attachments must be 8 MB or smaller.");
    return;
  }

  try {
    const data = await fileToDataURL(file);
    currentAttachment = {
      name: file.name,
      type: file.type || "application/octet-stream",
      data: data
    };
    updateAttachmentUI();
    $("promptInput").focus();
  } catch (error) {
    showNotice("I could not read that file.");
  }
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    showNotice("Voice input is not supported by this browser. Chrome or Safari usually works.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  $("voiceButton").textContent = "●";
  recognition.start();

  recognition.onresult = function (event) {
    const transcript = event.results[0][0].transcript;
    $("promptInput").value = transcript;
    resizeTextarea();
    $("promptInput").focus();
  };

  recognition.onerror = function () {
    showNotice("Voice input could not start. Check microphone permission.");
  };

  recognition.onend = function () {
    $("voiceButton").textContent = "◉";
  };
}

function speakIfEnabled(text) {
  if (!settings.speak || !("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
  utterance.lang = navigator.language || "en-US";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function applySettings() {
  $("profileName").textContent = settings.displayName || "Guest";
  $("avatarLetter").textContent = (settings.displayName || "Guest").trim().charAt(0).toUpperCase() || "G";
  document.body.classList.toggle("compact", !!settings.compact);
  document.body.classList.toggle("light", settings.theme === "light");
  $("themeButton").textContent = settings.theme === "light" ? "☾" : "☼";
}

function openSettings() {
  $("displayNameInput").value = settings.displayName || "Guest";
  $("speakToggle").checked = !!settings.speak;
  $("compactToggle").checked = !!settings.compact;
  $("settingsModal").classList.remove("hidden");
}

function closeSettings() {
  $("settingsModal").classList.add("hidden");
}

function saveSettings() {
  settings.displayName = $("displayNameInput").value.trim() || "Guest";
  settings.speak = $("speakToggle").checked;
  settings.compact = $("compactToggle").checked;
  saveJSON(SETTINGS_KEY, settings);
  applySettings();
  closeSettings();
}

function clearHistory() {
  conversations = [];
  currentId = null;
  saveConversations();
  renderHistory();
  renderConversation();
  closeSettings();
}

function toggleTheme() {
  settings.theme = settings.theme === "light" ? "dark" : "light";
  saveJSON(SETTINGS_KEY, settings);
  applySettings();
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 820) {
    $("sidebar").classList.remove("open");
  }
}

$("newChatButton").addEventListener("click", newChat);
$("brandButton").addEventListener("click", newChat);
$("sidebarSearch").addEventListener("click", function () {
  setTool("search");
  closeSidebarOnMobile();
});
$("sidebarImage").addEventListener("click", function () {
  setTool("image");
  closeSidebarOnMobile();
});
$("searchToggle").addEventListener("click", function () {
  setTool(activeTool === "search" ? null : "search");
});
$("clearMode").addEventListener("click", function () {
  setTool(null);
});
$("sendButton").addEventListener("click", sendMessage);
$("voiceButton").addEventListener("click", startVoice);
$("attachButton").addEventListener("click", function () {
  $("fileInput").click();
});
$("fileInput").addEventListener("change", function (event) {
  handleFile(event.target.files[0]);
  event.target.value = "";
});
$("removeAttachment").addEventListener("click", function () {
  currentAttachment = null;
  updateAttachmentUI();
});
$("promptInput").addEventListener("input", resizeTextarea);
$("promptInput").addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll(".starter-card").forEach(function (card) {
  card.addEventListener("click", function () {
    const tool = card.getAttribute("data-tool");
    const prompt = card.getAttribute("data-prompt");

    if (tool) setTool(tool);
    if (prompt) {
      $("promptInput").value = prompt;
      resizeTextarea();
      $("promptInput").focus();
    }
  });
});

$("settingsButton").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("saveSettings").addEventListener("click", saveSettings);
$("clearHistoryButton").addEventListener("click", clearHistory);
$("settingsModal").addEventListener("click", function (event) {
  if (event.target === $("settingsModal")) closeSettings();
});
$("themeButton").addEventListener("click", toggleTheme);
$("openSidebar").addEventListener("click", function () {
  $("sidebar").classList.add("open");
});
$("closeSidebar").addEventListener("click", function () {
  $("sidebar").classList.remove("open");
});

applySettings();
renderHistory();
renderConversation();
resizeTextarea();
loadHealth();
