/* ─── DOM参照 ─── */
const ui = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  tabBar: document.getElementById("tab-bar"),
  controls: document.getElementById("controls"),
  charFilters: document.getElementById("char-filters"),
  charFilterMenu: document.getElementById("charFilterMenu"),
  criticalStats: document.getElementById("criticalStats"),
  criticalRows: document.getElementById("criticalRows"),
  rollStatOptions: document.getElementById("rollStatOptions"),
  includeSpecial: document.getElementById("includeSpecial"),
  includeInitial: document.getElementById("includeInitial"),
  gmPanel: document.getElementById("gm-panel"),
  gmRows: document.getElementById("gm-rows"),
  gmInitialColor: document.getElementById("gmInitialColor"),
  iconPanel: document.getElementById("icon-panel"),
  iconRows: document.getElementById("icon-rows"),
  logArea: document.getElementById("logArea"),
  themeToggle: document.getElementById("themeToggle"),
  fontSizeButtons: document.querySelectorAll(".font-size-btn"),
  exportBtn: document.getElementById("exportBtn"),
  exportHtmlBtn: document.getElementById("exportHtmlBtn"),
  backToTop: document.getElementById("backToTop"),
  sourceModeButtons: document.querySelectorAll(".source-mode-btn"),
  dropZoneText: document.getElementById("dropZoneText"),
  dropZoneHint: document.getElementById("dropZoneHint"),
};

/* ─── 状態管理 ─── */
const state = {
  entries: [],
  activeTab: "all",
  activeChar: "all",
  rawHtml: "",
  allUniqueRawNames: [],
  colors: {},
  images: {},
  stills: {},
  loadedFileName: "",
  colorIdx: 0,
  sourceMode: "official",
  rawOfficialFiles: [],
  mainTab: "_",
  rollStatOptions: { special: false, initial: false },
  treatInitialColorAsGM: false,
};

/* フォールバック用パレット（ログにカラー指定がない場合に使用） */
const PALETTE = [
  "#4a7fa0",
  "#8a5c8a",
  "#5a8a62",
  "#a07840",
  "#6a5aaa",
  "#8a6840",
  "#408888",
  "#a05050",
  "#a08030",
  "#507a60",
  "#7060a0",
  "#906050",
];
function getColor(name) {
  if (!state.colors[name])
    state.colors[name] = PALETTE[state.colorIdx++ % PALETTE.length];
  return state.colors[name];
}
function safeLogColor(color) {
  return /^#[0-9a-f]{3,8}$/i.test(color || "") ? color : null;
}

/* ─── GM/PC 判定 ─── */
/* パネルに表示するデフォルトGM名の表示用リスト（空白・空文字は除く） */
const GM_DEFAULTS_DISPLAY = [
  "KP",
  "GM",
  "SKP",
  "SGM",
  "KP1",
  "KP2",
  "▼",
  "▽",
];

/* デフォルトのGMキー（正規化後の文字列で照合） */
const GM_KEYS_DEFAULT = new Set([
  "kp",
  "gm",
  "skp",
  "sgm",
  "kp1",
  "kp2",
  "",
  "　　",
  "　",
  "     ",
  "▼",
  "▽",
]);
const SYS_KEYS = new Set(["system", "システム"]);

const userGmNames = new Set(); // ユーザーがGMに指定した名前（正規化後）
const userPcNames = new Set(); // デフォルトGMだがユーザーがPCに変更した名前（正規化後）
const customAddedNames = []; // テキスト入力で手動追加したGM名（元の文字列）

function normalizeKey(raw) {
  return raw.replace(/[\s　]+/g, "").toLowerCase();
}

/* 発言者名からGM/PC/sysを判定 */
function isInitialNameColor(color) {
  const value = (color || "").replace(/\s/g, "").toLowerCase();
  return value === "#888" || value === "#888888" || value === "rgb(136,136,136)";
}
function isGMRole(raw, color = null) {
  const key = normalizeKey(raw);
  if (userPcNames.has(key)) return false; // ユーザーがPCに設定
  if (userGmNames.has(key)) return true; // ユーザーがGMに設定
  if (state.treatInitialColorAsGM && isInitialNameColor(color)) return true;
  if (GM_KEYS_DEFAULT.has(key)) return true; // デフォルトGM名
  if (/^[▼▽]/.test(raw.trim())) return true;
  if (/^[\s　 ]*$/.test(raw)) return true;
  return false;
}
function roleOf(raw, color = null) {
  const key = normalizeKey(raw);
  if (SYS_KEYS.has(key)) return "sys";
  if (isGMRole(raw, color)) return "gm";
  return "pc";
}

/* ─── ユーティリティ ─── */
/* HTMLエンティティデコード（&lt;→< など）—— parseLog で innerHTML から取り出したテキストに適用 */
function decodeHTML(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
/* HTML特殊文字エスケープ */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
/* 属性値用。ログ由来の名前をHTML属性へ出力する場合はこちらを使う。 */
function escAttr(s) {
  return esc(s)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
/* DataURL から拡張子を取得 */
function getExtFromDataUrl(dataUrl) {
  const m = dataUrl.match(/data:image\/(\w+);/);
  return m ? `.${m[1]}` : ".png";
}

/* 保存HTMLは通常、画面で読み込まれているCSSをそのまま埋め込む。
   file:// などCSSOMへアクセスできない環境だけ、内蔵フォールバックを使用する。 */
function getRuntimeStylesheetCss() {
  try {
    const link = document.querySelector('link[href*="ccfolia_formatter.css"]');
    const sheet = [...document.styleSheets].find((item) => item.ownerNode === link);
    return sheet ? [...sheet.cssRules].map((rule) => rule.cssText).join("\n") : "";
  } catch {
    return "";
  }
}

/* ─── ダイス判定 ─── */
const DICE_COMMANDS = new Set([
  "CC", "CCB", "CBR", "CBRB", "RES", "RESB", "FAR", "D66",
  "CHOICE", "REP", "REPEAT",
]);
function isDiceMessage(text) {
  if (!text.includes("＞")) return false;
  const first = text.split("\n")[0].trim();
  if (/^\d/.test(first)) return true;
  if (/^(?:x|rep|repeat)\d+/i.test(first)) return true;
  /* ソード・ワールド系の威力表／ダメージ計算（K35[...]、KeyNo.35c[...] など） */
  if (/^(?:k\d+(?:\[|$)|keyno\.\d+)/i.test(first)) return true;
  const cmd = first.toUpperCase().split(/[\s<=>(\[+\-]/)[0];
  return DICE_COMMANDS.has(cmd);
}

function subtabKind(tab) {
  if (tab === "情報") return "info";
  if (tab === "雑談") return "chat";
  return "other";
}

/* ─── ログパース ─── */
function parseLog(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const entries = [];
  const rawNamesSeen = new Set();

  doc.querySelectorAll("p").forEach((p) => {
    const spans = [...p.querySelectorAll(":scope > span")];
    if (!spans.length) return;

    let tab, speakerRaw, textHtml;

    if (spans.length >= 3) {
      /* フォーマット: [タブ名] / キャラ名 / 本文 */
      tab = spans[0].textContent.replace(/[\[\]\s　]/g, "").trim() || "_";
      speakerRaw = spans[1].textContent;
      textHtml = spans[spans.length - 1].innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .trim();
    } else if (spans.length === 2) {
      /* 旧来フォーマット: キャラ名 / 本文 */
      tab = "_";
      speakerRaw = spans[0].textContent;
      textHtml = spans[1].innerHTML.replace(/<br\s*\/?>/gi, "\n").trim();
    } else {
      /* span1つ: GM文章 */
      tab = "_";
      speakerRaw = "";
      textHtml = spans[0].innerHTML.replace(/<br\s*\/?>/gi, "\n").trim();
    }

    if (!textHtml) return;

    /* innerHTML の &lt; 等エンティティをデコードして正しい文字に戻す
       しないと fmt() の esc() で二重エンコードされ &lt; のまま表示される */
    textHtml = decodeHTML(textHtml);

    /* <p style="color:#xxxxxx;"> からキャラカラーを抽出 */
    const rawStyle = p.getAttribute("style") || "";
    const colorMatch = rawStyle.match(/color\s*:\s*([^;]+)/i);
    const logColor = colorMatch ? colorMatch[1].trim() : null;

    /* 発言者名を収集（GMパネル用）：空白のみ・システムは除外 */
    const trimmedSpeaker = speakerRaw.trim();
    if (
      trimmedSpeaker &&
      !/^[\s　 ]*$/.test(trimmedSpeaker) &&
      !SYS_KEYS.has(normalizeKey(trimmedSpeaker))
    ) {
      rawNamesSeen.add(trimmedSpeaker);
    }

    const type = roleOf(speakerRaw, safeLogColor(logColor));
    const speaker = type === "pc" ? speakerRaw.trim() : "";
    entries.push({
      type,
      tab,
      speaker,
      speakerRaw: speakerRaw.trim(),
      text: textHtml,
      color: safeLogColor(logColor),
      rollText: isDiceMessage(textHtml) ? textHtml : "",
      commandText: textHtml,
    });
  });

  /* ログの発言者名 + 手動追加名 を結合してGMパネルに渡す */
  state.allUniqueRawNames = [
    ...new Set([...rawNamesSeen, ...customAddedNames]),
  ];
  return entries;
}

/* ─── ココフォリア公式HTMLログのパース ───
   公式ZIPには「すべて」HTMLと各タブHTMLが同居する。前者を本文に使い、
   後者はランダムなチャンネルIDを人が読めるタブ名へ対応付けるために使う。 */
function officialTabName(filename, doc) {
  /* ZIP内の日本語ファイル名は文字コード情報がないことがあるため、
     信頼できるHTMLのtitleを優先する。 */
  const title = doc?.querySelector("title")?.textContent || "";
  const m = title.match(/\[([^\]]+)\]\s*$/) || filename.match(/\[([^\]]+)\](?:\.html?)?$/i);
  return m ? m[1] : filename.replace(/\.html?$/i, "");
}
function officialAvatarImages(doc) {
  const images = new Map();
  doc.querySelectorAll("style").forEach((style) => {
    /* 公式ログの `.avatar-image-N { background-image: url(data:...) }` を取得 */
    const re = /\.avatar-image-([^\s{]+)\s*\{[^}]*?background-image\s*:\s*url\(["']?(data:image\/[^"')\s]+)["']?\)/gi;
    let match;
    while ((match = re.exec(style.textContent))) images.set(`avatar-image-${match[1]}`, match[2]);
  });
  return images;
}
function parseOfficialLogs(files) {
  const parsed = files.map((file) => ({
    ...file,
    doc: new DOMParser().parseFromString(file.html, "text/html"),
  }));
  const channelNames = new Map();
  parsed.forEach(({ name, doc }) => {
    const tab = officialTabName(name, doc);
    if (tab === "すべて") return;
    const article = doc.querySelector("article.message[data-channel]");
    if (article) channelNames.set(article.dataset.channel, tab);
  });

  const allFile = parsed.find(({ name, doc }) => officialTabName(name, doc) === "すべて");
  const sources = allFile ? [allFile] : parsed;
  const entries = [];
  const rawNamesSeen = new Set();
  const seen = new Set();
  sources.forEach(({ name, doc }) => {
    const fallbackTab = officialTabName(name, doc);
    const avatarImages = officialAvatarImages(doc);
    doc.querySelectorAll("article.message[data-channel]").forEach((article) => {
      const channel = article.dataset.channel;
      const tab = channelNames.get(channel) || (channel === "main" ? "メイン" : fallbackTab);
      const speakerRaw = article.querySelector(".speaker")?.textContent.trim() || "";
      const message = article.querySelector(".message-text")?.textContent.trim() || "";
      const roll = article.querySelector(".roll-result")?.textContent.trim() || "";
      const logColor = safeLogColor(article.querySelector(".speaker")?.style.getPropertyValue("--speaker-color"));
      const text = [message, roll].filter(Boolean).join("\n");
      if (!text) return;
      const timestamp = article.querySelector("time")?.getAttribute("datetime") || "";
      const avatarClass = [...(article.querySelector(".avatar")?.classList || [])]
        .find((className) => className.startsWith("avatar-image-"));
      /* 個別HTMLを複数選択した場合の重複防止 */
      const key = `${channel}\u0000${timestamp}\u0000${speakerRaw}\u0000${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (speakerRaw && !SYS_KEYS.has(normalizeKey(speakerRaw))) rawNamesSeen.add(speakerRaw);
      /* 情報タブは内容そのものをGM情報として扱い、アイコンなしで表示する */
      const type = tab === "情報"
        ? "gm"
        : article.classList.contains("system")
          ? "sys"
          : roleOf(speakerRaw, logColor);
      entries.push({
        type,
        tab,
        speaker: type === "pc" ? speakerRaw : "",
        speakerRaw,
        text,
        rollText: roll,
        commandText: message,
        color: logColor,
        image: avatarClass ? avatarImages.get(avatarClass) || null : null,
        timestamp,
      });
    });
  });
  /* 「すべて」HTMLは公式が確定した時系列（時刻なしのシステム行を含む）を
     すでに持つため、再ソートせずDOM順を完全に維持する。 */
  if (!allFile) {
    entries.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  }
  state.allUniqueRawNames = [...new Set([...rawNamesSeen, ...customAddedNames])];
  state.mainTab = entries.some((e) => e.tab === "メイン") ? "メイン" : entries[0]?.tab || "_";
  return entries;
}

/* ─── テキスト整形 ─── */
/* テキストをHTML文字列に変換（会話・心理・記号をスタイリング）
   decodeHTML 済みのプレーンテキストを受け取ること */
function fmt(text) {
  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "<br>";
      let out = "",
        i = 0;
      while (i < line.length) {
        const ch = line[i];
        /* 「」→ dialogue クラス */
        if (ch === "「") {
          const e = line.indexOf("」", i);
          if (e !== -1) {
            out += `<span class="dialogue">「${esc(line.slice(i + 1, e))}」</span>`;
            i = e + 1;
            continue;
          }
        }
        /* （）()→ thought クラス */
        if (ch === "（" || ch === "(") {
          const cl = ch === "（" ? "）" : ")";
          const e = line.indexOf(cl, i);
          if (e !== -1) {
            out += `<span class="thought">${esc(line.slice(i, e + 1))}</span>`;
            i = e + 1;
            continue;
          }
        }
        /* 記号 → symbol クラス */
        if ("…─▷〆/".includes(ch)) {
          out += `<span class="symbol">${ch}</span>`;
          i++;
          continue;
        }
        out += esc(ch);
        i++;
      }
      return out;
    })
    .join("<br>");
}

/* ─── アバター ─── */
function makeAvatar(name) {
  const d = document.createElement("div");
  d.className = "avatar";
  d.setAttribute("aria-hidden", "true");
  d.dataset.charname = name;
  if (state.images[name]) {
    const img = document.createElement("img");
    img.src = state.images[name];
    img.alt = "";
    d.appendChild(img);
  } else {
    d.style.background = getColor(name);
  }
  return d;
}

/* アバター表示を更新（アイコン差し替え後に呼ぶ） */
function updateAvatars(sp) {
  document
    .querySelectorAll(`.avatar[data-charname="${CSS.escape(sp)}"]`)
    .forEach((av) => {
      av.innerHTML = "";
      av.style.background = "";
      if (state.images[sp]) {
        const img = document.createElement("img");
        img.src = state.images[sp];
        img.alt = "";
        av.appendChild(img);
      } else {
        av.style.background = getColor(sp);
      }
    });
}

/* キャラカラーを変更して全関連要素に反映 */
function updateCharColor(name, color) {
  state.colors[name] = color;
  document
    .querySelectorAll(
      `.speaker-name[data-charname="${CSS.escape(name)}"]`,
    )
    .forEach((el) => {
      el.style.color = color;
    });
  document
    .querySelectorAll(`.avatar[data-charname="${CSS.escape(name)}"]`)
    .forEach((av) => {
      if (!state.images[name]) av.style.background = color;
    });
  document
    .querySelectorAll(`.dot[data-charname="${CSS.escape(name)}"]`)
    .forEach((dot) => {
      dot.style.background = color;
    });
}

/* ─── スチル（静止画） ─── */
/* スチルスロットにスチル画像を表示 */
function showStill(slot, idx) {
  const still = state.stills[idx];
  slot.innerHTML = "";
  const a = document.createElement("a");
  a.href = still.dataUrl;
  a.target = "_blank";
  const img = document.createElement("img");
  img.className = "still-img";
  img.src = still.dataUrl;
  img.alt = "スチル";
  a.appendChild(img);
  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-still-btn";
  removeBtn.textContent = "✕";
  removeBtn.title = "スチルを削除";
  removeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    delete state.stills[idx];
    slot.innerHTML = "";
    slot.classList.remove("has-still");
  });
  slot.appendChild(a);
  slot.appendChild(removeBtn);
  slot.classList.add("has-still");
}

/* ファイル選択ダイアログを開いてスチルを設定 */
function triggerStillPicker(idx, slot) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      state.stills[idx] = { dataUrl: ev.target.result, filename: f.name };
      showStill(slot, idx);
    };
    r.readAsDataURL(f);
  });
  input.click();
}

/* ─── エントリー描画 ─── */
/* GM/ナレーターのラベル文字列を返す
   speakerRaw が空白でなければコマ名（"KP"など）をそのまま表示する */
function gmLabel(entry) {
  const s = entry.speakerRaw;
  /* 空白でない発言者名があればコマ名として表示（"KP"など） */
  if (s && !/^[\s　 ]*$/.test(s)) return s.trim();
  /* 空白のみ（ナレーター行）はタブ名でなく固定ラベル "GM" を返す */
  return "GM/KP";
}

/* エントリー要素を生成する
   idx: state.entries 内のインデックス（スチルの対応付けに使用） */
function makeEntryEl(entry, idx) {
  /* システムメッセージ：ラッパーなし・スチルなし */
  if (entry.type === "sys") {
    const d = document.createElement("div");
    d.className = "entry sys";
    if (state.sourceMode === "official" && entry.tab !== state.mainTab) {
      d.classList.add("from-subtab");
      d.classList.add(`subtab-${subtabKind(entry.tab)}`);
      const context = document.createElement("span");
      context.className = "tab-context";
      context.textContent = `【${entry.tab} タブ】`;
      d.appendChild(context);
    }
    const text = document.createElement("span");
    text.innerHTML = entry.text.split("\n").map(esc).join("<br>");
    d.appendChild(text);
    return d;
  }

  /* PC / GM：スチル対応のラッパーで包む */
  const wrapper = document.createElement("div");
  wrapper.className = "entry-wrapper";
  wrapper.dataset.entryType = entry.type;
  if (state.sourceMode === "official" && entry.tab !== state.mainTab) {
    wrapper.classList.add("from-subtab");
    wrapper.classList.add(`subtab-${subtabKind(entry.tab)}`);
    const context = document.createElement("div");
    context.className = "tab-context";
    context.textContent = `【${entry.tab} タブ】`;
    wrapper.appendChild(context);
  }

  /* スチルスロット（bubble または gm ブロック内に配置） */
  const stillSlot = document.createElement("div");
  stillSlot.className = "still-slot";

  const entryDiv = document.createElement("div");

  if (entry.type === "gm") {
    entryDiv.className = "entry gm" + (isDiceMessage(entry.text) ? " dice" : "");
    const lb = document.createElement("div");
    lb.className = "gm-label";
    lb.textContent = gmLabel(entry);
    const tx = document.createElement("div");
    tx.className = "gm-text";
    tx.innerHTML = fmt(entry.text);
    entryDiv.appendChild(lb);
    entryDiv.appendChild(tx);
    entryDiv.appendChild(stillSlot); // GMブロック内最下部
  } else {
    /* PC */
    wrapper.dataset.speaker = entry.speaker;
    entryDiv.className = "entry" + (isDiceMessage(entry.text) ? " dice" : "");
    const av = makeAvatar(entry.speaker);
    const bb = document.createElement("div");
    bb.className = "bubble";
    const nm = document.createElement("div");
    nm.className = "speaker-name";
    nm.dataset.charname = entry.speaker; // updateCharColor のターゲット
    nm.style.color = getColor(entry.speaker);
    nm.textContent = entry.speaker;
    const tx = document.createElement("div");
    tx.className = "speech-text";
    tx.innerHTML = fmt(entry.text);
    bb.appendChild(nm);
    bb.appendChild(tx);
    bb.appendChild(stillSlot); // バブル内最下部
    entryDiv.appendChild(av);
    entryDiv.appendChild(bb);
  }

  /* スチル追加ボタン（ホバーで表示） */
  const addBtn = document.createElement("button");
  addBtn.className = "add-still-btn";
  addBtn.textContent = "＋";
  addBtn.title = "スチルを追加";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    triggerStillPicker(idx, stillSlot);
  });

  wrapper.appendChild(entryDiv);
  wrapper.appendChild(addBtn);

  /* 既存のスチルを復元（reprocess 後も idx が変わらないため保持可能） */
  if (state.stills[idx]) showStill(stillSlot, idx);

  return wrapper;
}

function renderEntries(entries) {
  ui.logArea.innerHTML = "";
  if (!entries.length) {
    ui.logArea.innerHTML =
      '<div id="empty-state"><div class="big">📜</div>ログファイルを読み込むと整形されて表示されます</div>';
    return;
  }
  /* 全エントリーを時系列順に1つのセクションへ。各要素に data-entry-tab を付与し
     applyFilters でタブ絞り込みに使う */
  const section = document.createElement("div");
  section.className = "tab-section";
  entries.forEach((e, idx) => {
    const el = makeEntryEl(e, idx);
    el.dataset.entryTab = e.tab;
    section.appendChild(el);
  });
  ui.logArea.appendChild(section);
}

/* ─── タブバー ─── */
function buildTabBar(entries) {
  const tabs = [...new Set(entries.map((e) => e.tab))];
  ui.tabBar.innerHTML = "";
  if (tabs.length <= 1) {
    ui.tabBar.style.display = "none";
    return;
  }
  ui.tabBar.style.display = "flex";
  const all = document.createElement("button");
  all.className = "tab-btn active";
  all.dataset.tab = "all";
  all.textContent = "すべて";
  ui.tabBar.appendChild(all);
  tabs.forEach((tab) => {
    const b = document.createElement("button");
    b.className = "tab-btn";
    b.dataset.tab = tab;
    b.textContent = tab === "_" ? "(未分類)" : tab;
    ui.tabBar.appendChild(b);
  });
}
ui.tabBar.addEventListener("click", (e) => {
  const b = e.target.closest(".tab-btn");
  if (!b) return;
  state.activeTab = b.dataset.tab;
  ui.tabBar
    .querySelectorAll(".tab-btn")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.tab === state.activeTab),
    );
  applyFilters();
});

/* ─── キャラフィルター ─── */
function buildCharFilters(entries) {
  const speakers = [
    ...new Set(
      entries.filter((e) => e.type === "pc").map((e) => e.speaker),
    ),
  ];
  ui.charFilters.innerHTML = "";
  speakers.forEach((sp) => {
    const b = document.createElement("button");
    b.className = "filter-btn";
    b.dataset.filter = sp;
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.dataset.charname = sp; // updateCharColor のターゲット
    dot.style.background = getColor(sp);
    b.appendChild(dot);
    b.append(sp);
    ui.charFilters.appendChild(b);
  });
  ui.controls.style.display = "flex";
}

/* CoC6版の固定初期値スキル。能力値依存の回避・母国語はログだけでは判定不能なため除外。 */
const COC6_INITIAL_SKILLS = new Map([
  ["言いくるめ", 5], ["医学", 5], ["運転", 20], ["応急手当", 30], ["オカルト", 5],
  ["科学", 1], ["鍵開け", 1], ["隠す", 15], ["隠れる", 10], ["機械修理", 20],
  ["聞き耳", 25], ["キック", 25], ["クトゥルフ神話", 0], ["組み付き", 25], ["芸術", 5],
  ["経理", 10], ["拳銃", 20], ["考古学", 1], ["こぶし/パンチ", 50], ["コンピュータ", 1],
  ["サブマシンガン", 15], ["しのび歩き", 10], ["写真術", 10], ["重機械操作", 1], ["乗馬", 5],
  ["ショットガン", 30], ["信用", 15], ["心理学", 5], ["人類学", 1], ["水泳", 25],
  ["制作", 5], ["精神分析", 1], ["生物学", 1], ["説得", 15], ["操縦", 1], ["地質学", 1],
  ["跳躍", 25], ["追跡", 10], ["頭突き", 10], ["電気修理", 10], ["電子工学", 1],
  ["天文学", 1], ["投擲", 25], ["登攀", 40], ["図書館", 25], ["ナビゲート", 10],
  ["値切り", 5], ["博物学", 10], ["物理学", 1], ["変装", 1], ["法律", 5],
  ["他の言語", 1], ["マーシャルアーツ", 1], ["マシンガン", 15], ["目星", 25],
  ["薬学", 1], ["ライフル", 25], ["歴史", 20],
]);

function normalizeSkillName(name) {
  return (name || "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/／/g, "/")
    .replace(/[（(].*?[）)]/g, "");
}
function skillCheckDetails(entry) {
  const resultText = entry.rollText || (isDiceMessage(entry.text) ? entry.text : "");
  const commandText = entry.commandText || entry.text;
  const target = resultText.match(/1D100\s*<=\s*(\d+)/i)?.[1];
  const roll = resultText.match(/＞\s*(\d+)\s*＞/)?.[1];
  const skill = commandText.match(/【([^】]+)】/)?.[1] || "";
  const successful = /＞\s*(?:決定的成功|クリティカル|自動的成功|スペシャル|成功)/.test(resultText);
  return { resultText, target: Number(target), roll: Number(roll), skill: normalizeSkillName(skill), successful };
}

function criticalFumbleKind(entry) {
  /* 公式ログではダイス結果欄、従来ログではダイス行だけを確認する */
  const { resultText, target, roll, skill, successful } = skillCheckDetails(entry);
  const initialValue = COC6_INITIAL_SKILLS.get(skill);
  return {
    critical: /＞\s+(?:決定的成功|クリティカル|自動的成功)/.test(resultText),
    fumble: /＞\s+(?:致命的失敗|ファンブル|自動的失敗)/.test(resultText),
    /* 01はクリティカルとして別集計。スペシャルは02〜技能値の1/5とする。 */
    special: Boolean(skill && successful && roll > 1 && roll <= Math.floor(target / 5)),
    initial: Boolean(skill && successful && initialValue !== undefined && target === initialValue),
  };
}

function criticalFumbleStats(entries) {
  const results = new Map();
  entries.filter((entry) => entry.type === "pc").forEach((entry) => {
    if (!results.has(entry.speaker)) {
      results.set(entry.speaker, {
        speaker: entry.speaker, critical: 0, fumble: 0, special: 0, initial: 0,
      });
    }
    const kind = criticalFumbleKind(entry);
    if (kind.critical) {
      results.get(entry.speaker).critical++;
    }
    if (kind.fumble) {
      results.get(entry.speaker).fumble++;
    }
    if (kind.special) results.get(entry.speaker).special++;
    if (kind.initial) results.get(entry.speaker).initial++;
  });
  return [...results.values()].filter((stats) =>
    stats.critical || stats.fumble ||
    (state.rollStatOptions.special && stats.special) ||
    (state.rollStatOptions.initial && stats.initial),
  );
}

function activeStatLabels(kind) {
  return [
    kind.critical && "クリティカル",
    kind.fumble && "ファンブル",
    state.rollStatOptions.special && kind.special && "スペシャル",
    state.rollStatOptions.initial && kind.initial && "初期値成功",
  ].filter(Boolean);
}
function statSummary(stats) {
  return [
    `クリティカル ${stats.critical}回`,
    `ファンブル ${stats.fumble}回`,
    state.rollStatOptions.special && `スペシャル ${stats.special}回`,
    state.rollStatOptions.initial && `初期値成功 ${stats.initial}回`,
  ].filter(Boolean).join("、");
}

function criticalPreviewHtml(entries, speaker) {
  return entries
    .filter((entry) => entry.type === "pc" && entry.speaker === speaker)
    .map((entry) => ({ entry, kind: criticalFumbleKind(entry) }))
    .filter(({ kind }) => activeStatLabels(kind).length)
    .map(({ entry, kind }) => {
      const labels = activeStatLabels(kind).join(" / ");
      const tab = entry.tab && entry.tab !== "_" ? ` [${esc(entry.tab)}]` : "";
      return `<div class="critical-preview-entry"><span class="critical-preview-kind">${labels}${tab}</span>${fmt(entry.text)}</div>`;
    })
    .join("");
}

function buildCriticalStats(entries) {
  const stats = criticalFumbleStats(entries);
  ui.criticalRows.innerHTML = "";
  stats.forEach((stats) => {
    const { speaker } = stats;
    const row = document.createElement("div");
    row.className = "critical-stat-row";
    row.innerHTML = `<details class="critical-char-preview"><summary><span class="dot" data-charname="${escAttr(speaker)}" style="background:${getColor(speaker)}"></span><span class="critical-stat-name">${esc(speaker)}</span><span>${statSummary(stats)}</span></summary><div class="critical-preview-list">${criticalPreviewHtml(entries, speaker)}</div></details>`;
    ui.criticalRows.appendChild(row);
  });
  ui.criticalStats.style.display = stats.length ? "block" : "none";
  ui.rollStatOptions.style.display = entries.some((entry) => entry.type === "pc") ? "flex" : "none";
}

ui.includeSpecial.addEventListener("change", () => {
  state.rollStatOptions.special = ui.includeSpecial.checked;
  buildCriticalStats(state.entries);
});
ui.includeInitial.addEventListener("change", () => {
  state.rollStatOptions.initial = ui.includeInitial.checked;
  buildCriticalStats(state.entries);
});

ui.controls.addEventListener("click", (e) => {
  const b = e.target.closest(".filter-btn");
  if (!b || !b.dataset.filter) return;
  state.activeChar = b.dataset.filter;
  ui.controls
    .querySelectorAll(".filter-btn")
    .forEach((x) =>
      x.classList.toggle(
        "active",
        x.dataset.filter === state.activeChar ||
          (state.activeChar === "all" && x.dataset.filter === "all"),
      ),
    );
  ui.charFilterMenu.open = false;
  applyFilters();
});

/* ─── フィルター適用 ─── */
function applyFilters() {
  const filteringTab = state.activeTab !== "all";
  const filteringChar = state.activeChar !== "all";
  ui.logArea.classList.toggle("showing-all", !filteringTab);
  ui.logArea.classList.toggle("official-log", state.sourceMode === "official");

  document.querySelectorAll(".entry-wrapper").forEach((el) => {
    const tabHidden = filteringTab && el.dataset.entryTab !== state.activeTab;
    const type = el.dataset.entryType;
    const charHidden =
      type === "pc"
        ? filteringChar && el.dataset.speaker !== state.activeChar
        : filteringChar;
    el.classList.toggle("hidden", tabHidden || charHidden);
  });

  document.querySelectorAll(".entry.sys").forEach((el) => {
    const tabHidden = filteringTab && el.dataset.entryTab !== state.activeTab;
    el.classList.toggle("hidden", tabHidden || filteringChar);
  });
}

/* ─── GM/KP 名称設定パネル ─── */
function buildGMPanel(rawNames) {
  ui.gmRows.innerHTML =
    '<p class="panel-help">GM/KPと設定された発言者の発言はキャラクターと異なる文章表示に設定されます。結果としてキャラクターとそれ以外の情報が見分けやすくなり、ログが読みやすくなります。</p>';

  /* デフォルトGM名 ＋ ログの発言者名 ＋ 手動追加名 を重複なしで統合
     デフォルト名を先頭に置くことでパネル上部に表示される */
  const allPanelNames = [
    ...new Set([
      ...GM_DEFAULTS_DISPLAY,
      ...rawNames,
      ...customAddedNames,
    ]),
  ];

  allPanelNames.forEach((name) => {
    const key = normalizeKey(name);
    const hasInitialColor = state.entries.some(
      (entry) => entry.speakerRaw === name && isInitialNameColor(entry.color),
    );
    const currentlyGM = isGMRole(name, hasInitialColor ? "#888888" : null);

    const row = document.createElement("div");
    row.className = "gm-row";

    const nameLabel = document.createElement("div");
    nameLabel.className = "gm-row-name";
    nameLabel.textContent = name;

    const toggle = document.createElement("div");
    toggle.className = "gm-role-toggle";

    const gmBtn = document.createElement("button");
    gmBtn.className = "gm-role-btn" + (currentlyGM ? " is-gm" : "");
    gmBtn.textContent = "GM/KP";

    const pcBtn = document.createElement("button");
    pcBtn.className = "gm-role-btn" + (!currentlyGM ? " is-pc" : "");
    pcBtn.textContent = "キャラ";

    gmBtn.addEventListener("click", () => {
      if (currentlyGM) return;
      userGmNames.add(key);
      userPcNames.delete(key);
      reprocess();
    });
    pcBtn.addEventListener("click", () => {
      if (!currentlyGM) return;
      userPcNames.add(key);
      userGmNames.delete(key);
      reprocess();
    });

    toggle.appendChild(gmBtn);
    toggle.appendChild(pcBtn);
    row.appendChild(nameLabel);
    row.appendChild(toggle);
    ui.gmRows.appendChild(row);
  });

  /* ログに存在しない名前を手動でGMとして追加するフォーム */
  const addRow = document.createElement("div");
  addRow.className = "gm-add-row";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "ログにない名前をGMとして追加...";
  const addBtn = document.createElement("button");
  addBtn.className = "export-btn";
  addBtn.style.fontSize = "0.78rem";
  addBtn.textContent = "GM追加";
  addBtn.addEventListener("click", () => {
    const name = addInput.value.trim();
    if (!name) return;
    const key = normalizeKey(name);
    userGmNames.add(key);
    userPcNames.delete(key);
    if (!customAddedNames.includes(name)) customAddedNames.push(name);
    addInput.value = "";
    reprocess();
  });
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addBtn.click();
  });
  addRow.appendChild(addInput);
  addRow.appendChild(addBtn);
  ui.gmRows.appendChild(addRow);

  ui.gmPanel.style.display = "block";
}

ui.gmInitialColor.addEventListener("change", () => {
  state.treatInitialColorAsGM = ui.gmInitialColor.checked;
  reprocess();
});

/* ─── キャラクター設定パネル（アイコン・カラー） ─── */
function buildIconPanel(entries) {
  const speakers = [
    ...new Set(
      entries.filter((e) => e.type === "pc").map((e) => e.speaker),
    ),
  ];
  ui.iconRows.innerHTML =
    '<p class="panel-help">既存のアイコンを上書きして差し替えたり、既存のキャラクターコマの色を上書きして変更できます。</p>';
  speakers.forEach((sp) => {
    const row = document.createElement("div");
    row.className = "icon-row";

    /* ミニアバター付きキャラ名ラベル */
    const lbl = document.createElement("div");
    lbl.className = "char-label";
    const mini = document.createElement("div");
    mini.className = "av-mini";
    mini.setAttribute("aria-hidden", "true");
    if (state.images[sp]) {
      mini.style.backgroundImage = `url(${state.images[sp]})`;
      mini.style.backgroundSize = "cover";
    } else {
      mini.style.background = getColor(sp);
    }
    lbl.appendChild(mini);
    lbl.append(sp);

    /* カラーピッカー（ログのカラーコードが初期値） */
    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.className = "color-picker";
    colorPicker.value = getColor(sp);
    colorPicker.title = "キャラカラーを変更";
    colorPicker.addEventListener("input", (e) => {
      updateCharColor(sp, e.target.value);
      if (!state.images[sp]) mini.style.background = e.target.value;
    });

    /* アイコン画像選択 */
    const fi = document.createElement("input");
    fi.type = "file";
    fi.accept = "image/*";
    const prev = document.createElement("img");
    prev.className = "preview-img";
    prev.alt = "";
    if (state.images[sp]) {
      prev.src = state.images[sp];
      prev.style.display = "block";
    }
    const clr = document.createElement("button");
    clr.className = "clear-btn";
    clr.textContent = "✕ 削除";
    if (state.images[sp]) clr.style.display = "inline";

    fi.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        state.images[sp] = ev.target.result;
        updateAvatars(sp);
        mini.style.background = "";
        mini.style.backgroundImage = `url(${ev.target.result})`;
        mini.style.backgroundSize = "cover";
        prev.src = ev.target.result;
        prev.style.display = "block";
        clr.style.display = "inline";
      };
      r.readAsDataURL(f);
    });
    clr.addEventListener("click", () => {
      delete state.images[sp];
      updateAvatars(sp);
      mini.style.backgroundImage = "";
      mini.style.background = getColor(sp);
      prev.style.display = "none";
      prev.src = "";
      clr.style.display = "none";
      fi.value = "";
    });

    row.appendChild(lbl);
    row.appendChild(colorPicker);
    row.appendChild(fi);
    row.appendChild(prev);
    row.appendChild(clr);
    ui.iconRows.appendChild(row);
  });
  ui.iconPanel.style.display = "block";
}

/* ─── レンダリング ─── */
function render() {
  renderEntries(state.entries);
  buildTabBar(state.entries);
  buildCharFilters(state.entries);
  buildCriticalStats(state.entries);
  buildGMPanel(state.allUniqueRawNames);
  buildIconPanel(state.entries);
  applyFilters();
}

/* ─── ファイル読み込み ─── */
/* isNewFile=true: 新規ファイルで全リセット / false: GM設定変更による再処理 */
function processHTML(html, isNewFile = true) {
  state.sourceMode = "legacy";
  state.entries = parseLog(html);
  if (!state.entries.length) return;

  if (isNewFile) {
    /* 新規ファイル: すべての状態をリセット */
    Object.keys(state.colors).forEach((k) => delete state.colors[k]);
    Object.keys(state.images).forEach((k) => delete state.images[k]);
    Object.keys(state.stills).forEach((k) => delete state.stills[k]);
    userGmNames.clear();
    userPcNames.clear();
    customAddedNames.length = 0;
    state.colorIdx = 0;
    state.activeTab = "all";
    state.activeChar = "all";
    state.rawHtml = html; // 再処理用に保持
    state.rawOfficialFiles = [];
    state.mainTab = "_";
  }

  /* ログのカラーコードを優先使用（同名キャラは初出カラーを使用、isNewFile=false では既存カラーを保持） */
  state.entries
    .filter((e) => e.type === "pc")
    .forEach((e) => {
      if (!state.colors[e.speaker]) {
        state.colors[e.speaker] =
          e.color || PALETTE[state.colorIdx++ % PALETTE.length];
      }
    });

  render();
}

function processOfficialFiles(files, isNewFile = true) {
  state.sourceMode = "official";
  if (isNewFile) {
    Object.keys(state.colors).forEach((k) => delete state.colors[k]);
    Object.keys(state.images).forEach((k) => delete state.images[k]);
    Object.keys(state.stills).forEach((k) => delete state.stills[k]);
    userGmNames.clear();
    userPcNames.clear();
    customAddedNames.length = 0;
    state.colorIdx = 0;
    state.activeTab = "all";
    state.activeChar = "all";
    state.rawOfficialFiles = files;
    state.rawHtml = "";
  }
  state.entries = parseOfficialLogs(files);
  if (!state.entries.length) {
    alert("公式HTMLログ内にメッセージが見つかりませんでした。");
    return;
  }
  state.entries.filter((e) => e.type === "pc").forEach((e) => {
    if (!state.images[e.speaker] && e.image) state.images[e.speaker] = e.image;
    if (!state.colors[e.speaker]) {
      state.colors[e.speaker] = e.color || PALETTE[state.colorIdx++ % PALETTE.length];
    }
  });
  render();
}

/* GM/PC設定変更後の再処理（カラー・アイコン・スチルは保持） */
function reprocess() {
  if (state.sourceMode === "official" && state.rawOfficialFiles.length) {
    processOfficialFiles(state.rawOfficialFiles, false);
  } else if (state.rawHtml) {
    processHTML(state.rawHtml, false);
  }
}

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("ZIPライブラリを初期化できませんでした"));
    script.onerror = () => reject(new Error("ZIPの読み込みにはインターネット接続が必要です。展開済みHTML一式ならオフラインでも読み込めます。"));
    document.head.appendChild(script);
  });
}

/* ログ用途として十分な上限。圧縮爆弾や誤選択によるメモリ消費を防ぐ。 */
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_HTML_FILES = 50;
const MAX_EXTRACTED_LOG_BYTES = 30 * 1024 * 1024;

async function readOfficialFiles(selected) {
  const htmlFiles = [];
  let totalBytes = 0;
  let htmlCount = 0;
  for (const file of selected) {
    if (/\.zip$/i.test(file.name)) {
      if (file.size > MAX_ZIP_BYTES) {
        throw new Error("ZIPが20MiBを超えています。ログZIPとしては大きすぎるため読み込みを中止しました");
      }
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.html?$/i.test(entry.name));
      if (htmlCount + entries.length > MAX_HTML_FILES) {
        throw new Error("HTMLファイルが50件を超えています");
      }
      const declaredBytes = entries.reduce(
        (sum, entry) => sum + (entry._data?.uncompressedSize || 0),
        0,
      );
      if (declaredBytes > MAX_EXTRACTED_LOG_BYTES) {
        throw new Error("展開後のHTML合計が30MiBを超えています");
      }
      for (const entry of entries) {
        const html = await entry.async("text");
        totalBytes += new Blob([html]).size;
        if (totalBytes > MAX_EXTRACTED_LOG_BYTES) {
          throw new Error("展開後のHTML合計が30MiBを超えています");
        }
        htmlCount++;
        htmlFiles.push({ name: entry.name.split("/").pop(), html });
      }
    } else if (/\.html?$/i.test(file.name)) {
      if (++htmlCount > MAX_HTML_FILES) throw new Error("HTMLファイルが50件を超えています");
      if (file.size > MAX_EXTRACTED_LOG_BYTES) throw new Error("HTMLが30MiBを超えています");
      totalBytes += file.size;
      if (totalBytes > MAX_EXTRACTED_LOG_BYTES) throw new Error("HTML合計が30MiBを超えています");
      htmlFiles.push({ name: file.name, html: await file.text() });
    }
  }
  if (!htmlFiles.length) throw new Error("ZIP内または選択したファイルにHTMLログがありません");
  return htmlFiles;
}

function setSourceMode(mode, clearInput = false) {
  state.sourceMode = mode;
  ui.sourceModeButtons.forEach((button) =>
    button.classList.toggle("active", button.dataset.mode === mode),
  );
  /* 自動判別を妨げないよう、どちらの形式でも選択できる状態を保つ */
  ui.fileInput.accept = ".zip,.html,.htm";
  ui.fileInput.multiple = true;
  const official = mode === "official";
  ui.dropZoneText.textContent = official
    ? "公式HTMLログのZIP、または展開済みHTML一式をドロップ／選択"
    : "従来ログをドロップ、またはクリックして選択";
  ui.dropZoneHint.textContent = official
    ? ".zip / 複数の .html / .htm に対応（形式は自動判別）"
    : ".html / .htm に対応（形式は自動判別）";
  if (clearInput) ui.fileInput.value = "";
}

async function detectLogMode(selected) {
  if (selected.some((file) => /\.zip$/i.test(file.name))) return "official";
  const firstHtml = selected.find((file) => /\.html?$/i.test(file.name));
  if (!firstHtml) return state.sourceMode;
  const html = await firstHtml.text();
  /* 公式形式は article.message と data-channel を持つ。従来ログのp/span形式とは区別可能。 */
  return /<article\b(?=[^>]*\bdata-channel\s*=)(?=[^>]*\bclass\s*=\s*["'][^"']*\bmessage\b)/i.test(html)
    ? "official"
    : "legacy";
}

async function loadFiles(files) {
  const selected = [...files];
  if (!selected.length) return;
  const detectedMode = await detectLogMode(selected);
  setSourceMode(detectedMode);
  if (detectedMode === "official") {
    try {
      const officialFiles = await readOfficialFiles(selected);
      state.loadedFileName = officialFiles[0]?.name.replace(/\.[^.]+$/, "") || "ccfolia_log";
      processOfficialFiles(officialFiles, true);
    } catch (err) {
      alert(`公式HTMLログを読み込めませんでした: ${err.message}`);
    }
    return;
  }
  const f = selected[0];
  state.loadedFileName = f.name.replace(/\.[^.]+$/, "");
  const r = new FileReader();
  r.onload = (ev) => processHTML(ev.target.result, true);
  r.readAsText(f, "utf-8");
}

ui.fileInput.addEventListener("change", (e) => {
  loadFiles(e.target.files);
});
ui.dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  ui.dropZone.classList.add("dragover");
});
ui.dropZone.addEventListener("dragleave", () =>
  ui.dropZone.classList.remove("dragover"),
);
ui.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.dropZone.classList.remove("dragover");
  loadFiles(e.dataTransfer.files);
});

ui.sourceModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSourceMode(button.dataset.mode, true);
  });
});

/* ─── テーマ切り替え ─── */
ui.themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "light" : "dark";
  ui.themeToggle.textContent = isDark ? "🌙" : "☀";
});

/* ─── 文字サイズ ─── */
ui.fontSizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const size = button.dataset.fontSize;
    document.documentElement.dataset.fontSize = size;
    ui.fontSizeButtons.forEach((item) =>
      item.classList.toggle("active", item === button),
    );
  });
});

/* ─── ページ上部へ戻る ─── */
function updateBackToTop() {
  if (!ui.backToTop) return;
  /* ブラウザや埋め込みプレビューでスクロール要素が異なる場合にも対応 */
  const scrollTop = Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body.scrollTop || 0,
  );
  ui.backToTop.classList.toggle("visible", scrollTop > 240);
}
window.addEventListener("scroll", updateBackToTop, { passive: true });
document.addEventListener("scroll", updateBackToTop, { passive: true, capture: true });
window.addEventListener("resize", updateBackToTop, { passive: true });
requestAnimationFrame(updateBackToTop);
if (ui.backToTop) {
  ui.backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
}

/* ─── テキストエクスポート ─── */
ui.exportBtn.addEventListener("click", () => {
  const lines = [];
  state.entries.forEach((e) => {
    const tl = e.tab && e.tab !== "_" ? `[${e.tab}] ` : "";
    if (e.type === "sys") {
      lines.push("", `${tl}── システム`, e.text, "");
    } else if (e.type === "gm") {
      lines.push("", `${tl}── ${gmLabel(e)}`, e.text, "");
    } else {
      lines.push(`${tl}【${e.speaker}】`, e.text, "");
    }
  });
  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "log_formatted.txt";
  a.click();
});

/* ─── HTMLエクスポート（画像もData URLで埋め込む単一HTML） ─── */
ui.exportHtmlBtn.addEventListener("click", async () => {
    /* 同じBase64アイコンを発言ごとに複製せず、CSS定義を一度だけ出力する。 */
    const exportAvatarClasses = new Map();
    const exportAvatarCss = Object.entries(state.images)
      .map(([speaker, dataUrl], index) => {
        const className = `export-avatar-${index}`;
        exportAvatarClasses.set(speaker, className);
        return `.avatar.${className}{background-image:url("${dataUrl}");background-size:cover;background-position:center;background-repeat:no-repeat;}`;
      })
      .join("\n");

    /* 画面DOMをクローンしてエクスポート用に変換する。
       makeEntryEl が唯一の構造定義となり、二重管理を排除する */
    function exportEntryNode(node, entry, idx) {
      const clone = node.cloneNode(true);
      clone.classList.remove("hidden");
      // 操作系ボタンはエクスポート不要
      clone.querySelectorAll(".add-still-btn, .remove-still-btn").forEach(b => b.remove());
      /* imgのData URLは各発言に重複するため、共有CSSクラスへ置き換える */
      if (entry.type === "pc" && exportAvatarClasses.has(entry.speaker)) {
        const avatar = clone.querySelector(".avatar");
        if (avatar) {
          avatar.classList.add(exportAvatarClasses.get(entry.speaker));
          avatar.innerHTML = "";
          avatar.style.background = "";
        }
      }
      return clone.outerHTML;
    }

    const expTabs = [...new Set(state.entries.map((e) => e.tab))];
    const expSpeakers = [
      ...new Set(
        state.entries
          .filter((e) => e.type === "pc")
          .map((e) => e.speaker),
      ),
    ];

    const tabBtnsHtml =
      expTabs.length > 1
        ? `<button class="tab-btn active" data-tab="all">すべて</button>` +
          expTabs
            .map(
              (t) =>
                `<button class="tab-btn" data-tab="${escAttr(t)}">${t === "_" ? "(未分類)" : esc(t)}</button>`,
            )
            .join("")
        : "";

    const charBtnsHtml = expSpeakers
      .map(
        (sp) =>
          `<button class="filter-btn" data-filter="${escAttr(sp)}"><span class="dot" style="background:${getColor(sp)}"></span>${esc(sp)}</button>`,
      )
      .join("");
    const criticalRowsHtml = criticalFumbleStats(state.entries)
      .map(
        (stats) =>
          `<div class="critical-stat-row"><details class="critical-char-preview"><summary><span class="dot" style="background:${getColor(stats.speaker)}"></span><span class="critical-stat-name">${esc(stats.speaker)}</span><span>${statSummary(stats)}</span></summary><div class="critical-preview-list">${criticalPreviewHtml(state.entries, stats.speaker)}</div></details></div>`,
      )
      .join("");
    const enabledStatTypes = [
      "クリティカル", "ファンブル",
      state.rollStatOptions.special && "スペシャル",
      state.rollStatOptions.initial && "初期値成功",
    ].filter(Boolean).join("・");

    const domNodes = Array.from(ui.logArea.querySelector(".tab-section").children);
    const bodyHtml =
      `<div class="tab-section">\n` +
      state.entries.map((e, i) => exportEntryNode(domNodes[i], e, i)).join("\n") +
      `\n</div>`;

    /* エクスポート用CSS（ダーク＋ライト両テーマ、スチル含む） */
    const fallbackCss = `
:root{--bg:#111010;--surface:#1c1b1a;--surface2:#252321;--border:rgba(255,255,255,0.1);--border-mid:rgba(255,255,255,0.18);--text:#f0ebe3;--text-sub:#b8b0a6;--muted:#6a6460;--accent:#d4a96a;--gm-bg:#161616;--gm-text:#a8a8a4;--gm-border:#383838;--gm-label:#686866;--sys-bg:#181818;--sys-text:#909090;--sys-border:#333;--dialogue:#f5e8d0;--thought:#c4b8cc;}
html[data-font-size="small"]{font-size:16px;}html[data-font-size="medium"]{font-size:18px;}html[data-font-size="large"]{font-size:20px;}
[data-theme="light"]{--bg:#f5f3ef;--surface:#ffffff;--surface2:#eeebe5;--border:rgba(0,0,0,0.1);--border-mid:rgba(0,0,0,0.22);--text:#1a1815;--text-sub:#4a4540;--muted:#8a8480;--accent:#b07818;--gm-bg:#f0ede8;--gm-text:#4a4845;--gm-border:#c8bfb5;--gm-label:#8a8480;--sys-bg:#ece9e4;--sys-text:#606060;--sys-border:#b8b0a8;--dialogue:#7a3c18;--thought:#5a3880;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Hiragino Sans','Yu Gothic','YuGothic','Meiryo',sans-serif;min-height:100vh;padding:2rem 1rem;transition:background 0.2s,color 0.2s;}
.wrapper{max-width:860px;margin:0 auto;width:100%;}
.theme-toggle{position:fixed;top:1rem;right:1rem;width:36px;height:36px;border-radius:50%;border:1px solid var(--border-mid);background:var(--surface);color:var(--text-sub);cursor:pointer;font-size:1.05rem;display:flex;align-items:center;justify-content:center;transition:all .15s;z-index:100;}
.theme-toggle:hover{border-color:var(--accent);color:var(--accent);}
.back-to-top{position:fixed;right:1.25rem;bottom:1.25rem;z-index:100;width:44px;height:44px;border:1px solid var(--border-mid);border-radius:50%;background:var(--surface);color:var(--accent);box-shadow:0 3px 12px rgba(0,0,0,.22);cursor:pointer;font:700 1.35rem/1 sans-serif;opacity:0;pointer-events:none;transform:translateY(10px);transition:opacity .18s,transform .18s,border-color .18s;}.back-to-top.visible{opacity:1;pointer-events:auto;transform:translateY(0);}.back-to-top:hover{border-color:var(--accent);}
.font-size-controls{display:flex;align-items:center;gap:.25rem;margin:0 0 1rem;color:var(--muted);font-size:.72rem;}.font-size-controls>span{margin-right:.2rem;}.font-size-btn{min-width:1.8rem;padding:.18rem .35rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text-sub);font:inherit;cursor:pointer;}.font-size-btn.active{border-color:var(--accent);color:var(--accent);}
#tab-bar{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem;}
#tab-bar:empty{display:none;}
.tab-btn{padding:.28rem .85rem;border-radius:999px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);font-size:.8rem;font-family:inherit;cursor:pointer;transition:all .15s;user-select:none;}
.tab-btn.active{background:var(--accent);color:var(--bg);border-color:var(--accent);}
.tab-btn:hover:not(.active){color:var(--text-sub);border-color:var(--border-mid);}
.controls{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1.2rem;}
.char-filter-menu{position:relative;min-width:190px;}.char-filter-menu summary{display:flex;align-items:center;gap:.45rem;padding:.4rem .8rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-sub);font-size:.82rem;cursor:pointer;list-style:none;user-select:none;}.char-filter-menu summary::-webkit-details-marker{display:none;}.char-filter-menu summary::before{content:'▼';color:var(--accent);font-size:.68rem;transition:transform .15s;}.char-filter-menu[open] summary{border-color:var(--accent);border-radius:6px 6px 0 0;}.char-filter-menu[open] summary::before{transform:rotate(180deg);}.char-filter-options{position:absolute;top:calc(100% - 1px);left:0;z-index:30;display:flex;flex-wrap:wrap;gap:.45rem;width:min(440px,calc(100vw - 2rem));padding:.7rem;border:1px solid var(--accent);border-radius:0 6px 6px 6px;background:var(--surface);box-shadow:0 8px 20px rgba(0,0,0,.2);}
.critical-stats{margin:0 0 1.4rem;padding:1rem 1.2rem;border:1px solid var(--border);border-radius:8px;background:var(--surface);}.critical-stats>summary{display:flex;align-items:center;gap:6px;color:var(--text-sub);font-size:.82rem;cursor:pointer;list-style:none;user-select:none;}.critical-stats>summary::-webkit-details-marker,.critical-char-preview>summary::-webkit-details-marker{display:none;}.critical-stats>summary::before{content:'▶';font-size:.6rem;transition:transform .15s;}.critical-stats[open]>summary::before{transform:rotate(90deg);}.critical-stats .panel-body,.critical-preview-list{display:flex;flex-direction:column;gap:.6rem;margin-top:.9rem;}.critical-stat-row{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;color:var(--text-sub);font-size:.82rem;}.critical-stat-row .dot{width:8px;height:8px;border-radius:50%;}.critical-stat-name{min-width:130px;font-weight:600;}.critical-char-preview{width:100%;}.critical-char-preview>summary{display:flex;align-items:center;gap:.45rem;cursor:pointer;list-style:none;}.critical-char-preview>summary::before{content:'▷';font-size:.6rem;}.critical-char-preview[open]>summary::before{content:'▽';}.critical-preview-list{gap:.45rem;margin:.65rem 0 .15rem 1rem;padding-left:.8rem;border-left:2px solid var(--border-mid);}.critical-preview-entry{padding:.55rem .7rem;border-radius:4px;background:var(--surface2);color:var(--text-sub);font-size:.84rem;line-height:1.7;word-break:break-all;}.critical-preview-kind{display:inline-block;margin-right:.45rem;color:var(--accent);font-size:.7rem;font-weight:700;}
.filter-btn{display:inline-flex;align-items:center;gap:6px;padding:.28rem .85rem;border-radius:20px;border:1px solid var(--border);background:var(--surface);color:var(--text-sub);font-size:.8rem;cursor:pointer;transition:all .15s;font-family:inherit;user-select:none;}
.filter-btn .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.filter-btn.active{border-color:var(--accent);color:var(--accent);background:rgba(212,169,106,.1);}
[data-theme="light"] .filter-btn.active{background:rgba(176,120,24,.08);}
.filter-btn:hover:not(.active){border-color:var(--border-mid);}
.filter-all{display:inline-flex;align-items:center;gap:6px;padding:.28rem .85rem;border-radius:20px;border:1px solid var(--border);background:var(--surface);color:var(--text-sub);font-size:.8rem;cursor:pointer;transition:all .15s;font-family:inherit;user-select:none;}
.filter-all.active{border-color:var(--accent);color:var(--accent);background:rgba(212,169,106,.1);}
[data-theme="light"] .filter-all.active{background:rgba(176,120,24,.08);}
.filter-all:hover:not(.active){border-color:var(--border-mid);}
.log-area{display:flex;flex-direction:column;}
.tab-section{display:flex;flex-direction:column;}
.tab-section.hidden{display:none;}
.entry-wrapper{position:relative;}
.entry{display:flex;padding:1rem 0;border-bottom:.5px solid var(--border);transition:background .1s;}
.entry:hover{background:rgba(128,128,128,.03);}
.avatar{width:38px;min-width:38px;height:38px;border-radius:50%;margin-right:1rem;margin-top:2px;flex-shrink:0;overflow:hidden;}
.avatar img{width:100%;height:100%;object-fit:cover;display:block;}
.bubble{flex:1;min-width:0;}
.speaker-name{font-size:.8rem;font-weight:600;margin-bottom:.35rem;letter-spacing:.02em;}
.speech-text{font-size:1rem;line-height:1.9;color:var(--text);word-break:break-all;}
.speech-text .dialogue{color:var(--dialogue);}
.speech-text .thought{color:var(--thought);font-size:.95rem;}
.speech-text .symbol{color:var(--muted);}
.entry.gm{padding:.8rem 1rem .8rem 1.1rem;background:var(--gm-bg);border-left:3px solid var(--gm-border);border-bottom:none;border-radius:4px;margin:.3rem 0;flex-direction:column;}
.entry.gm .gm-label{font-size:.72rem;font-weight:600;letter-spacing:.06em;color:var(--gm-label);margin-bottom:.4rem;}
.entry.gm .gm-text{font-size:1rem;color:var(--gm-text);line-height:1.9;word-break:break-all;}
.entry.gm .gm-text .dialogue{color:var(--dialogue);}
.entry.gm .gm-text .thought{color:var(--thought);}
.entry.gm .gm-text .symbol{color:var(--muted);}
.entry.sys{padding:.4rem .9rem .4rem 1rem;background:var(--sys-bg);border-left:2px solid var(--sys-border);border-bottom:none;border-radius:3px;margin:.2rem 0;font-size:.85rem;color:var(--sys-text);line-height:1.6;font-family:'Courier New',monospace;word-break:break-all;}
.still-slot{display:none;}
.still-slot.has-still{display:block;margin-top:.6rem;}
.still-slot.has-still img.still-img{width:100%;max-width:100%;border-radius:6px;display:block;cursor:pointer;transition:opacity .15s;}
.still-slot.has-still img.still-img:hover{opacity:.93;}
.entry.dice .speech-text{font-family:'Courier New',monospace;font-size:.85rem;color:var(--text-sub);}
.entry.gm.dice .gm-text{font-family:'Courier New',monospace;font-size:.85rem;color:var(--muted);}
.entry-wrapper.hidden{display:none!important;}
.entry.sys.hidden{display:none!important;}
.log-area.official-log .avatar{border-radius:0;}
.log-area.showing-all .entry-wrapper.from-subtab{--subtab-accent:var(--accent);--subtab-bg:var(--surface2);margin:.35rem 0;padding:.35rem .8rem .35rem 1rem;border-left:6px solid var(--subtab-accent);border-radius:5px;background:var(--subtab-bg);box-shadow:inset 0 0 0 1px var(--border-mid);}.log-area.showing-all .entry-wrapper.subtab-chat{--subtab-accent:#77818b;--subtab-bg:rgba(119,129,139,.13);}.log-area.showing-all .entry-wrapper.subtab-other{--subtab-accent:#5f91b5;--subtab-bg:rgba(95,145,181,.13);}
.log-area.showing-all .entry.sys.from-subtab{--subtab-accent:var(--accent);--subtab-bg:var(--surface2);border-left:6px solid var(--subtab-accent);background:var(--subtab-bg);}.log-area.showing-all .entry.sys.subtab-chat{--subtab-accent:#77818b;--subtab-bg:rgba(119,129,139,.13);}.log-area.showing-all .entry.sys.subtab-other{--subtab-accent:#5f91b5;--subtab-bg:rgba(95,145,181,.13);}
.tab-context{display:none;}.log-area.showing-all .tab-context{display:inline-block;margin:0 0 .45rem;padding:.18rem .6rem;border-radius:3px;background:var(--subtab-accent,var(--accent));color:var(--bg);font-size:.72rem;font-weight:700;letter-spacing:.08em;line-height:1.25;}`;
    const exportCssOverrides = `
#tab-bar{display:flex;}
#controls{display:flex;}
.settings-panel.export-critical-stats{display:block;}
#themeToggle{position:fixed;top:1rem;right:1rem;z-index:100;}
`;
    /* 共有アバターCSSは、実行時CSS／フォールバックのどちらを使う場合にも必ず追加する。 */
    const css = `${getRuntimeStylesheetCss() || fallbackCss}\n${exportAvatarCss}\n${exportCssOverrides}`;

    /* エクスポート用JS（テーマ切り替え＋タブ＋キャラフィルター） */
    const js = `
(function(){
  var activeTab='all', activeChar='all';
  function applyFilters(){
    var filteringTab=activeTab!=='all';
    var filteringChar=activeChar!=='all';
    var logArea=document.querySelector('.log-area');
    if(logArea)logArea.classList.toggle('showing-all',!filteringTab);
    document.querySelectorAll('.entry-wrapper').forEach(function(el){
var tabHidden=filteringTab&&el.dataset.entryTab!==activeTab;
var type=el.dataset.entryType;
var charHidden=type==='pc'
  ?(filteringChar&&el.dataset.speaker!==activeChar)
  :filteringChar;
el.classList.toggle('hidden',tabHidden||charHidden);
    });
    document.querySelectorAll('.entry.sys').forEach(function(el){
var tabHidden=filteringTab&&el.dataset.entryTab!==activeTab;
el.classList.toggle('hidden',tabHidden||filteringChar);
    });
  }
  var tabBar=document.getElementById('tab-bar');
  if(tabBar)tabBar.addEventListener('click',function(e){
    var b=e.target.closest('.tab-btn');if(!b)return;
    activeTab=b.dataset.tab;
    tabBar.querySelectorAll('.tab-btn').forEach(function(x){x.classList.toggle('active',x.dataset.tab===activeTab);});
    applyFilters();
  });
  var controls=document.getElementById('controls');
  if(controls)controls.addEventListener('click',function(e){
    var b=e.target.closest('.filter-btn,.filter-all');if(!b)return;
    activeChar=b.dataset.filter||'all';
    controls.querySelectorAll('.filter-btn,.filter-all').forEach(function(x){
x.classList.toggle('active',(x.dataset.filter||'all')===activeChar);
    });
    var menu=b.closest('.char-filter-menu');if(menu)menu.open=false;
    applyFilters();
  });
  var toggle=document.getElementById('themeToggle');
  if(toggle)toggle.addEventListener('click',function(){
    var isDark=document.documentElement.dataset.theme==='dark';
    document.documentElement.dataset.theme=isDark?'light':'dark';
    toggle.textContent=isDark?'🌙':'☀';
  });
  document.querySelectorAll('.font-size-btn').forEach(function(button){button.addEventListener('click',function(){document.documentElement.dataset.fontSize=button.dataset.fontSize;document.querySelectorAll('.font-size-btn').forEach(function(item){item.classList.toggle('active',item===button);});});});
  var backToTop=document.getElementById('backToTop');
  function updateBackToTop(){if(!backToTop)return;var scrollTop=Math.max(window.scrollY||0,document.documentElement.scrollTop||0,document.body.scrollTop||0);backToTop.classList.toggle('visible',scrollTop>240);}
  window.addEventListener('scroll',updateBackToTop,{passive:true});
  document.addEventListener('scroll',updateBackToTop,{passive:true,capture:true});window.addEventListener('resize',updateBackToTop,{passive:true});requestAnimationFrame(updateBackToTop);
  if(backToTop)backToTop.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});document.documentElement.scrollTop=0;document.body.scrollTop=0;});
})();`;

    /* 現在のテーマを引き継いでエクスポート */
    const currentTheme = document.documentElement.dataset.theme || "dark";
    const currentFontSize = document.documentElement.dataset.fontSize || "small";
    const out = `<!DOCTYPE html>
<html lang="ja" data-theme="${currentTheme}" data-font-size="${currentFontSize}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ログ</title>
<style>${css}</style>
</head>
<body>
<button class="theme-toggle" id="themeToggle">${currentTheme === "dark" ? "☀" : "🌙"}</button>
<button class="back-to-top" id="backToTop" type="button" title="ページ上部へ戻る" aria-label="ページ上部へ戻る">↑</button>
<div class="wrapper">
<div class="font-size-controls" role="group" aria-label="文字サイズ"><span>文字サイズ</span><button class="font-size-btn${currentFontSize === "small" ? " active" : ""}" type="button" data-font-size="small">小</button><button class="font-size-btn${currentFontSize === "medium" ? " active" : ""}" type="button" data-font-size="medium">中</button><button class="font-size-btn${currentFontSize === "large" ? " active" : ""}" type="button" data-font-size="large">大</button></div>
${expTabs.length > 1 ? `<div id="tab-bar">${tabBtnsHtml}</div>` : '<div id="tab-bar"></div>'}
<div class="controls" id="controls">
<details class="char-filter-menu">
<summary>発言キャラを絞り込む</summary>
<div class="char-filter-options">
<button class="filter-btn active" data-filter="all">すべてのキャラ</button>
${charBtnsHtml}
</div>
</details>
</div>
${criticalRowsHtml ? `<details class="settings-panel critical-stats export-critical-stats"><summary>クリファン回数</summary><div class="panel-body"><p class="panel-help">集計対象：${enabledStatTypes}</p>${criticalRowsHtml}</div></details>` : ""}
<div class="log-area showing-all${state.sourceMode === "official" ? " official-log" : ""}">
${bodyHtml}
</div>
</div>
<script>${js}${"</" + "script>"}
</body>
</html>`;

    function exportBaseName() {
      const base = state.loadedFileName || "log";
      const now = new Date();
      const ts = now.getFullYear().toString()
        + String(now.getMonth() + 1).padStart(2, "0")
        + String(now.getDate()).padStart(2, "0")
        + "_"
        + String(now.getHours()).padStart(2, "0")
        + String(now.getMinutes()).padStart(2, "0")
        + String(now.getSeconds()).padStart(2, "0");
      return `${base}[整形済]${ts}`;
    }

    const blob = new Blob([out], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportBaseName()}.html`;
    a.click();
  });
