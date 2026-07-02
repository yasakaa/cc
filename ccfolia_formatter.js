/* ─── DOM参照 ─── */
const ui = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  tabBar: document.getElementById("tab-bar"),
  controls: document.getElementById("controls"),
  charFilters: document.getElementById("char-filters"),
  stats: document.getElementById("stats"),
  gmPanel: document.getElementById("gm-panel"),
  gmRows: document.getElementById("gm-rows"),
  iconPanel: document.getElementById("icon-panel"),
  iconRows: document.getElementById("icon-rows"),
  logArea: document.getElementById("logArea"),
  themeToggle: document.getElementById("themeToggle"),
  exportBtn: document.getElementById("exportBtn"),
  exportHtmlBtn: document.getElementById("exportHtmlBtn"),
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
function isGMRole(raw) {
  const key = normalizeKey(raw);
  if (userPcNames.has(key)) return false; // ユーザーがPCに設定
  if (userGmNames.has(key)) return true; // ユーザーがGMに設定
  if (GM_KEYS_DEFAULT.has(key)) return true; // デフォルトGM名
  if (/^[▼▽]/.test(raw.trim())) return true;
  if (/^[\s　 ]*$/.test(raw)) return true;
  return false;
}
function roleOf(raw) {
  const key = normalizeKey(raw);
  if (SYS_KEYS.has(key)) return "sys";
  if (isGMRole(raw)) return "gm";
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
/* DataURL から拡張子を取得 */
function getExtFromDataUrl(dataUrl) {
  const m = dataUrl.match(/data:image\/(\w+);/);
  return m ? `.${m[1]}` : ".png";
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
  const cmd = first.toUpperCase().split(/[\s<=>(\[+\-]/)[0];
  return DICE_COMMANDS.has(cmd);
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

    const type = roleOf(speakerRaw);
    const speaker = type === "pc" ? speakerRaw.trim() : "";
    entries.push({
      type,
      tab,
      speaker,
      speakerRaw: speakerRaw.trim(),
      text: textHtml,
      color: logColor,
    });
  });

  /* ログの発言者名 + 手動追加名 を結合してGMパネルに渡す */
  state.allUniqueRawNames = [
    ...new Set([...rawNamesSeen, ...customAddedNames]),
  ];
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
    d.innerHTML = entry.text.split("\n").map(esc).join("<br>");
    return d;
  }

  /* PC / GM：スチル対応のラッパーで包む */
  const wrapper = document.createElement("div");
  wrapper.className = "entry-wrapper";
  wrapper.dataset.entryType = entry.type;

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
  const counts = {};
  speakers.forEach((sp) => {
    counts[sp] = entries.filter((e) => e.speaker === sp).length;
  });
  ui.stats.innerHTML = speakers
    .map(
      (sp) =>
        `<span><span class="dot" data-charname="${esc(sp)}" style="background:${getColor(sp)}"></span>${esc(sp)}：${counts[sp]}回</span>`,
    )
    .join("");
  ui.controls.style.display = "flex";
}

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
  applyFilters();
});

/* ─── フィルター適用 ─── */
function applyFilters() {
  const filteringTab = state.activeTab !== "all";
  const filteringChar = state.activeChar !== "all";

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
  ui.gmRows.innerHTML = "";

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
    const currentlyGM = isGMRole(name);

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
      if (isGMRole(name)) return;
      userGmNames.add(key);
      userPcNames.delete(key);
      reprocess();
    });
    pcBtn.addEventListener("click", () => {
      if (!isGMRole(name)) return;
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

/* ─── キャラクター設定パネル（アイコン・カラー） ─── */
function buildIconPanel(entries) {
  const speakers = [
    ...new Set(
      entries.filter((e) => e.type === "pc").map((e) => e.speaker),
    ),
  ];
  ui.iconRows.innerHTML = "";
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
  buildGMPanel(state.allUniqueRawNames);
  buildIconPanel(state.entries);
  applyFilters();
}

/* ─── ファイル読み込み ─── */
/* isNewFile=true: 新規ファイルで全リセット / false: GM設定変更による再処理 */
function processHTML(html, isNewFile = true) {
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

/* GM/PC設定変更後の再処理（カラー・アイコン・スチルは保持） */
function reprocess() {
  if (state.rawHtml) processHTML(state.rawHtml, false);
}

ui.fileInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.loadedFileName = f.name.replace(/\.[^.]+$/, "");
  const r = new FileReader();
  r.onload = (ev) => processHTML(ev.target.result, true);
  r.readAsText(f, "utf-8");
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
  const f = e.dataTransfer.files[0];
  if (!f) return;
  state.loadedFileName = f.name.replace(/\.[^.]+$/, "");
  const r = new FileReader();
  r.onload = (ev) => processHTML(ev.target.result, true);
  r.readAsText(f, "utf-8");
});

/* ─── テーマ切り替え ─── */
ui.themeToggle.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "light" : "dark";
  ui.themeToggle.textContent = isDark ? "🌙" : "☀";
});

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

/* ─── HTMLエクスポート（キャラ画像がある場合はZIP） ─── */
ui.exportHtmlBtn.addEventListener("click", async () => {
    const hasCharImages = Object.keys(state.images).length > 0;
    const hasStills = Object.keys(state.stills).length > 0;
    const needsZip = hasCharImages || hasStills;
    function safeName(s) {
      return s.replace(/[\\/:*?"<>|]/g, "_");
    }
    function imgExt(d) {
      return d.match(/\/(\w+);/)?.[1] || "png";
    }

    /* 画面DOMをクローンしてエクスポート用に変換する。
       makeEntryEl が唯一の構造定義となり、二重管理を排除する */
    function exportEntryNode(node, entry, idx) {
      const clone = node.cloneNode(true);
      clone.classList.remove("hidden");
      // 操作系ボタンはエクスポート不要
      clone.querySelectorAll(".add-still-btn, .remove-still-btn").forEach(b => b.remove());
      // アバター画像: DataURL → images/ファイル参照に差し替え
      if (entry.type === "pc" && state.images[entry.speaker]) {
        const img = clone.querySelector(".avatar img");
        if (img) img.src = `images/${safeName(entry.speaker)}.${imgExt(state.images[entry.speaker])}`;
      }
      // スチル: stills/ フォルダへのパスに差し替え
      const slot = clone.querySelector(".still-slot");
      if (slot && state.stills[idx]) {
        const ext = imgExt(state.stills[idx].dataUrl);
        const stillPath = `stills/${idx}.${ext}`;
        slot.innerHTML = `<a href="${stillPath}" target="_blank"><img class="still-img" src="${stillPath}" alt="スチル"></a>`;
        slot.classList.add("has-still");
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
                `<button class="tab-btn" data-tab="${t}">${t === "_" ? "(未分類)" : t}</button>`,
            )
            .join("")
        : "";

    const charBtnsHtml = expSpeakers
      .map(
        (sp) =>
          `<button class="filter-btn" data-filter="${esc(sp)}"><span class="dot" style="background:${getColor(sp)}"></span>${esc(sp)}</button>`,
      )
      .join("");

    const domNodes = Array.from(ui.logArea.querySelector(".tab-section").children);
    const bodyHtml =
      `<div class="tab-section">\n` +
      state.entries.map((e, i) => exportEntryNode(domNodes[i], e, i)).join("\n") +
      `\n</div>`;

    /* エクスポート用CSS（ダーク＋ライト両テーマ、スチル含む） */
    const css = `
:root{--bg:#111010;--surface:#1c1b1a;--surface2:#252321;--border:rgba(255,255,255,0.1);--border-mid:rgba(255,255,255,0.18);--text:#f0ebe3;--text-sub:#b8b0a6;--muted:#6a6460;--accent:#d4a96a;--gm-bg:#161616;--gm-text:#a8a8a4;--gm-border:#383838;--gm-label:#686866;--sys-bg:#181818;--sys-text:#909090;--sys-border:#333;--dialogue:#f5e8d0;--thought:#c4b8cc;}
[data-theme="light"]{--bg:#f5f3ef;--surface:#ffffff;--surface2:#eeebe5;--border:rgba(0,0,0,0.1);--border-mid:rgba(0,0,0,0.22);--text:#1a1815;--text-sub:#4a4540;--muted:#8a8480;--accent:#b07818;--gm-bg:#f0ede8;--gm-text:#4a4845;--gm-border:#c8bfb5;--gm-label:#8a8480;--sys-bg:#ece9e4;--sys-text:#606060;--sys-border:#b8b0a8;--dialogue:#7a3c18;--thought:#5a3880;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Hiragino Sans','Yu Gothic','YuGothic','Meiryo',sans-serif;min-height:100vh;padding:2rem 1rem;transition:background 0.2s,color 0.2s;}
.wrapper{max-width:860px;margin:0 auto;width:100%;}
.theme-toggle{position:fixed;top:1rem;right:1rem;width:36px;height:36px;border-radius:50%;border:1px solid var(--border-mid);background:var(--surface);color:var(--text-sub);cursor:pointer;font-size:1.05rem;display:flex;align-items:center;justify-content:center;transition:all .15s;z-index:100;}
.theme-toggle:hover{border-color:var(--accent);color:var(--accent);}
#tab-bar{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem;padding-bottom:.8rem;border-bottom:1px solid var(--border);}
#tab-bar:empty{display:none;}
.tab-btn{padding:.28rem .85rem;border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;background:var(--surface2);color:var(--muted);font-size:.8rem;font-family:inherit;cursor:pointer;transition:all .15s;user-select:none;}
.tab-btn.active{background:var(--surface);color:var(--accent);border-color:var(--accent);}
.tab-btn:hover:not(.active){color:var(--text-sub);border-color:var(--border-mid);}
.controls{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1.2rem;}
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
.entry.sys.hidden{display:none!important;}`;

    /* エクスポート用JS（テーマ切り替え＋タブ＋キャラフィルター） */
    const js = `
(function(){
  var activeTab='all', activeChar='all';
  function applyFilters(){
    var filteringTab=activeTab!=='all';
    var filteringChar=activeChar!=='all';
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
    applyFilters();
  });
  var toggle=document.getElementById('themeToggle');
  if(toggle)toggle.addEventListener('click',function(){
    var isDark=document.documentElement.dataset.theme==='dark';
    document.documentElement.dataset.theme=isDark?'light':'dark';
    toggle.textContent=isDark?'🌙':'☀';
  });
})();`;

    /* 現在のテーマを引き継いでエクスポート */
    const currentTheme = document.documentElement.dataset.theme || "dark";
    const out = `<!DOCTYPE html>
<html lang="ja" data-theme="${currentTheme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ログ</title>
<style>${css}</style>
</head>
<body>
<button class="theme-toggle" id="themeToggle">${currentTheme === "dark" ? "☀" : "🌙"}</button>
<div class="wrapper">
${expTabs.length > 1 ? `<div id="tab-bar">${tabBtnsHtml}</div>` : '<div id="tab-bar"></div>'}
<div class="controls" id="controls">
<button class="filter-all active" data-filter="all">すべてのキャラ</button>
${charBtnsHtml}
</div>
<div class="log-area">
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

    if (!needsZip) {
      const blob = new Blob([out], { type: "text/html;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${exportBaseName()}.html`;
      a.click();
      return;
    }

    /* 画像あり: ZIP として出力 */
    const btn = ui.exportHtmlBtn;
    btn.textContent = "準備中...";
    btn.disabled = true;
    try {
      await new Promise((res, rej) => {
        if (window.JSZip) {
          res();
          return;
        }
        const s = document.createElement("script");
        s.src =
          "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.onload = () =>
          requestAnimationFrame(() =>
            window.JSZip
              ? res()
              : rej(new Error("JSZip の初期化に失敗しました")),
          );
        s.onerror = () =>
          rej(new Error("JSZip の読み込みに失敗しました"));
        document.head.appendChild(s);
      });
      const expName = exportBaseName();
      const zip = new JSZip();
      zip.file(`${expName}.html`, out);
      if (hasCharImages) {
        const imgF = zip.folder("images");
        for (const [name, dataUrl] of Object.entries(state.images)) {
          const [hdr, b64] = dataUrl.split(",");
          const ext = hdr.match(/\/(\w+);/)?.[1] || "png";
          imgF.file(`${safeName(name)}.${ext}`, b64, { base64: true });
        }
      }
      if (hasStills) {
        const stillF = zip.folder("stills");
        for (const [idx, { dataUrl }] of Object.entries(state.stills)) {
          const [hdr, b64] = dataUrl.split(",");
          const ext = hdr.match(/\/(\w+);/)?.[1] || "png";
          stillF.file(`${idx}.${ext}`, b64, { base64: true });
        }
      }
      const zb = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zb);
      a.download = `${expName}.zip`;
      a.click();
    } catch (e) {
      alert("エクスポートに失敗しました: " + e.message);
    } finally {
      btn.textContent = "HTMLで保存";
      btn.disabled = false;
    }
  });