/*
SCRIPTMETA-BEGIN
Script-ID=com.gyahtei.dtp.replace-font-character-set.indesign
Version=1.0.4
Meta-URL=https://github.com/SatoruTakahashi7/InDesign-character-set-font-replacer
Target-App=indesign
Name=文字セットの書体へ置換 / Replace Fonts by Character Set
Author=GYAHTEI Design Laboratory / Satoru Takahashi
Description-BEGIN
InDesignドキュメントで使用または定義されている和文フォントを調べ、
同じ書体系列・同じスタイルで文字セットだけが異なるインストール済み書体へ置換します。
本文、段落スタイル、文字スタイル、合成フォントの構成書体を対象にします。
Description-END
SCRIPTMETA-END


    文字セット書体置換.jsx

    Version: 1.0.4
    Updated: 2026-08-04
    GYAHTEI Design Laboratory
    @gyahtei_satoru
    Developed with ChatGPT

    簡単な説明
    文書で使われているフォントごとに、同じ書体系列・同じスタイルで
    文字セットだけが異なるインストール済みフォントを候補表示します。
    存在しない変換先は表示しません。

    対象
    ・ドキュメント本文（すべてのストーリー）
    ・段落スタイル（グループ内を含む）
    ・文字スタイル（グループ内を含む）
    ・合成フォント内の各構成書体

    対応する文字セット表記
    Std / StdN / Pro / ProN / Pr5 / Pr5N / Pr6 / Pr6N

    操作
    1. InDesignで対象ドキュメントを開きます。
    2. このスクリプトを実行します。
    3. 一覧から現在のフォントを選びます。
    4. 「このフォントの変換先」で、実在する候補を選びます。
    5. 必要な行を設定して「置換」をクリックします。

    注意事項
    ・フォント名、PostScript名、CIDのregistry/order情報から和文書体と文字セットを判定します。
    ・書体系列またはスタイル名が一致しないフォントは候補にしません。
    ・文字セット名を含まないフォントは対象外です。
    ・変換元は未インストールでも対象になります。変換先だけをインストール済みに限定します。
    ・相互入れ替えなど、変換が循環する指定は同時実行できません。
    ・ロックされたテキストや編集できない合成フォント項目などは変更できない場合があります。
    ・処理は原則として「編集 ＞ 取り消し」1回で戻せます。
    ・実行前に保存し、最初は複製ドキュメントで確認してください。
    ・本スクリプトの使用は、利用者自身の責任で行ってください。
    ・本スクリプトの使用により生じたデータ損失、文字化け、レイアウト崩れ、
      その他一切の損害について、制作者・提供者は責任を負いません。

    Credits:
    - Planning / testing / direction: GYAHTEI Design Laboratory @gyahtei_satoru
    - Development support: ChatGPT
*/

#target "InDesign"

(function () {
    var SCRIPT_NAME = "文字セットの書体へ置換";
    var SCRIPT_VERSION = "v1.0.4";
    var CHARACTER_SETS = ["Std", "StdN", "Pro", "ProN", "Pr5", "Pr5N", "Pr6", "Pr6N"];
    // 長い表記を先に判定し、Pr5NをPr5、Pr6NをPr6として誤認しないようにします。
    var DETECTION_ORDER = ["Pr6N", "Pr5N", "ProN", "StdN", "Pr6", "Pr5", "Pro", "Std"];

    function main() {
        if (app.documents.length === 0) {
            alert("ドキュメントを開いてから実行してください。", SCRIPT_NAME);
            return;
        }

        var doc = app.activeDocument;
        var appFontInfos = collectApplicationFontInfos();
        var sourceData = collectSourceFonts(doc, appFontInfos);
        var rows = buildRows(sourceData, appFontInfos);

        if (rows.length === 0) {
            alert(buildNoCandidateMessage(sourceData), SCRIPT_NAME);
            return;
        }

        rows.sort(function (a, b) {
            var aa = a.source.displayLabel.toLowerCase();
            var bb = b.source.displayLabel.toLowerCase();
            if (aa < bb) return -1;
            if (aa > bb) return 1;
            return 0;
        });

        var mappings = showMappingDialog(rows, sourceData);
        if (mappings === null) return;
        if (mappings.length === 0) {
            alert("変換先が1件も選択されていません。", SCRIPT_NAME);
            return;
        }

        var orderedResult = orderMappings(mappings);
        if (!orderedResult.ok) {
            alert(
                "変換指定が循環しています。\n\n" +
                orderedResult.message + "\n\n" +
                "相互入れ替えになる行のどちらかを「変更しない」にしてください。",
                SCRIPT_NAME
            );
            return;
        }

        var report = null;
        app.doScript(
            function () {
                report = applyMappings(doc, orderedResult.mappings, sourceData.resolutionFontInfos);
            },
            ScriptLanguage.JAVASCRIPT,
            undefined,
            UndoModes.ENTIRE_SCRIPT,
            SCRIPT_NAME
        );

        alert(buildReport(report), SCRIPT_NAME);
    }

    function collectApplicationFontInfos() {
        var fonts = collectionToArray(app.fonts);
        var infos = [];
        var seen = {};

        for (var i = 0; i < fonts.length; i++) {
            var info = makeFontInfo(fonts[i]);
            if (!info || !info.characterSet || !isInstalledFont(fonts[i])) continue;
            if (!seen[info.identityKey]) {
                seen[info.identityKey] = true;
                infos.push(info);
            }
        }
        return infos;
    }

    function collectSourceFonts(doc, appFontInfos) {
        var data = {
            list: [],
            byKey: {},
            detectedWithoutCandidates: [],
            resolutionFontInfos: [],
            resolutionByKey: {}
        };

        for (var a = 0; a < appFontInfos.length; a++) {
            addResolutionFont(data, appFontInfos[a]);
        }

        var docFonts = collectionToArray(doc.fonts);
        for (var i = 0; i < docFonts.length; i++) {
            addSourceFont(data, makeFontInfo(docFonts[i]), "本文");
        }

        collectStyleFonts(doc.allParagraphStyles, "段落スタイル", data);
        collectStyleFonts(doc.allCharacterStyles, "文字スタイル", data);

        var compositeFonts = collectionToArray(doc.compositeFonts);
        for (var c = 0; c < compositeFonts.length; c++) {
            var entries = collectionToArray(compositeFonts[c].compositeFontEntries);
            for (var e = 0; e < entries.length; e++) {
                var entryInfo = resolveAssignedFont(entries[e], data.resolutionFontInfos);
                addSourceFont(data, entryInfo, "合成フォント");
            }
        }

        return data;
    }

    function collectStyleFonts(styles, usageName, data) {
        var list = collectionToArray(styles);
        for (var i = 0; i < list.length; i++) {
            var info = resolveAssignedFont(list[i], data.resolutionFontInfos);
            addSourceFont(data, info, usageName);
        }
    }

    function addSourceFont(data, info, usageName) {
        if (!info || !info.characterSet) return;

        addResolutionFont(data, info);

        var existing = data.byKey[info.identityKey];
        if (!existing) {
            existing = {
                info: info,
                usage: {},
                hasCandidates: false
            };
            data.byKey[info.identityKey] = existing;
            data.list.push(existing);
        }
        existing.usage[usageName] = true;
    }

    function addResolutionFont(data, info) {
        if (!info || !info.identityKey || data.resolutionByKey[info.identityKey]) return;
        data.resolutionByKey[info.identityKey] = true;
        data.resolutionFontInfos.push(info);
    }

    function buildRows(sourceData, appFontInfos) {
        var rows = [];
        for (var i = 0; i < sourceData.list.length; i++) {
            var sourceItem = sourceData.list[i];
            var candidates = findCandidates(sourceItem.info, appFontInfos);

            if (candidates.length === 0) {
                sourceData.detectedWithoutCandidates.push(sourceItem.info.displayLabel);
                continue;
            }

            sourceItem.hasCandidates = true;
            rows.push({
                source: sourceItem.info,
                candidates: candidates,
                usageLabel: usageToString(sourceItem.usage),
                selectedTarget: null
            });
        }
        return rows;
    }

    function findCandidates(source, appFontInfos) {
        var result = [];
        var seenSets = {};

        for (var i = 0; i < appFontInfos.length; i++) {
            var target = appFontInfos[i];
            if (target.identityKey === source.identityKey) continue;
            if (target.characterSet === source.characterSet) continue;
            if (!isSameSeriesAndStyle(source, target)) continue;

            var uniqueKey = target.characterSet + "|" + target.identityKey;
            if (!seenSets[uniqueKey]) {
                seenSets[uniqueKey] = true;
                result.push(target);
            }
        }

        result.sort(function (a, b) {
            var ai = characterSetIndex(a.characterSet);
            var bi = characterSetIndex(b.characterSet);
            if (ai !== bi) return ai - bi;
            if (a.displayLabel < b.displayLabel) return -1;
            if (a.displayLabel > b.displayLabel) return 1;
            return 0;
        });
        return result;
    }

    function isSameSeriesAndStyle(a, b) {
        if (a.postscriptBase && b.postscriptBase && a.postscriptBase === b.postscriptBase) {
            return true;
        }
        return a.familyBase && b.familyBase &&
            a.familyBase === b.familyBase &&
            a.styleKey === b.styleKey;
    }

    function showMappingDialog(rows, sourceData) {
        var dialog = new Window("dialog", SCRIPT_NAME + " " + SCRIPT_VERSION);
        dialog.orientation = "column";
        dialog.alignChildren = "fill";
        dialog.margins = 16;
        dialog.spacing = 10;

        var description = dialog.add(
            "statictext",
            undefined,
            "一覧から現在のフォントを選び、その行の変換先を指定してください。\n" +
            "変換先には、同じ書体系列・同じスタイルで実在する候補だけを表示します。",
            { multiline: true }
        );
        description.preferredSize.width = 720;

        var list = dialog.add("listbox", undefined, [], { multiselect: false });
        list.preferredSize = [720, 290];

        for (var i = 0; i < rows.length; i++) {
            var item = list.add("item", rowDisplayText(rows[i]));
            item.rowIndex = i;
        }

        var editorPanel = dialog.add("panel", undefined, "選択中のフォント");
        editorPanel.orientation = "column";
        editorPanel.alignChildren = "fill";
        editorPanel.margins = 14;
        editorPanel.spacing = 8;

        var sourceText = editorPanel.add("statictext", undefined, "");
        sourceText.preferredSize.width = 690;

        var targetGroup = editorPanel.add("group");
        targetGroup.orientation = "row";
        targetGroup.alignChildren = ["left", "center"];
        targetGroup.add("statictext", undefined, "このフォントの変換先：");
        var targetDropdown = targetGroup.add("dropdownlist", undefined, []);
        targetDropdown.preferredSize.width = 475;

        var hiddenCount = sourceData.detectedWithoutCandidates.length;
        var note = dialog.add(
            "statictext",
            undefined,
            hiddenCount > 0
                ? "変換候補が存在しない使用フォント " + hiddenCount + "件は一覧から除外しています。"
                : "変換候補が存在しない項目は表示していません。"
        );

        var buttons = dialog.add("group");
        buttons.alignment = "right";
        buttons.add("button", undefined, "キャンセル", { name: "cancel" });
        buttons.add("button", undefined, "置換", { name: "ok" });

        var updating = false;

        function loadSelectedRow() {
            if (!list.selection) return;
            updating = true;

            var row = rows[list.selection.rowIndex];
            sourceText.text =
                "現在：［" + row.source.characterSet + "］" + row.source.displayLabel +
                sourceStatusSuffix(row.source) +
                "　（" + row.usageLabel + "）";

            targetDropdown.removeAll();
            var keepItem = targetDropdown.add("item", "（変更しない）");
            keepItem.targetInfo = null;

            var selectedIndex = 0;
            for (var i = 0; i < row.candidates.length; i++) {
                var candidate = row.candidates[i];
                var ddItem = targetDropdown.add(
                    "item",
                    "［" + candidate.characterSet + "］" + candidate.displayLabel
                );
                ddItem.targetInfo = candidate;
                if (row.selectedTarget && row.selectedTarget.identityKey === candidate.identityKey) {
                    selectedIndex = i + 1;
                }
            }
            targetDropdown.selection = selectedIndex;
            updating = false;
        }

        list.onChange = loadSelectedRow;
        targetDropdown.onChange = function () {
            if (updating || !list.selection || !targetDropdown.selection) return;
            var row = rows[list.selection.rowIndex];
            row.selectedTarget = targetDropdown.selection.targetInfo;
            list.selection.text = rowDisplayText(row);
        };

        list.selection = 0;
        loadSelectedRow();

        if (dialog.show() !== 1) return null;

        var mappings = [];
        for (var r = 0; r < rows.length; r++) {
            if (rows[r].selectedTarget) {
                mappings.push({
                    source: rows[r].source,
                    target: rows[r].selectedTarget
                });
            }
        }
        return mappings;
    }

    function rowDisplayText(row) {
        var targetText = row.selectedTarget
            ? "［" + row.selectedTarget.characterSet + "］" + row.selectedTarget.displayLabel
            : "（変更しない）";
        return "［" + row.source.characterSet + "］" + row.source.displayLabel +
            sourceStatusSuffix(row.source) + "  →  " + targetText;
    }

    function sourceStatusSuffix(source) {
        return source.isInstalled ? "" : "（未インストール）";
    }

    function orderMappings(mappings) {
        var bySource = {};
        var state = {};
        var ordered = [];

        for (var i = 0; i < mappings.length; i++) {
            bySource[mappings[i].source.identityKey] = mappings[i];
        }

        function visit(mapping, path) {
            var key = mapping.source.identityKey;
            if (state[key] === 2) return { ok: true };
            if (state[key] === 1) {
                return {
                    ok: false,
                    message: path + " → " + mapping.source.displayLabel
                };
            }

            state[key] = 1;
            var next = bySource[mapping.target.identityKey];
            if (next) {
                var nextResult = visit(next, path + " → " + mapping.target.displayLabel);
                if (!nextResult.ok) return nextResult;
            }
            state[key] = 2;
            ordered.push(mapping);
            return { ok: true };
        }

        for (var m = 0; m < mappings.length; m++) {
            var result = visit(mappings[m], mappings[m].source.displayLabel);
            if (!result.ok) return result;
        }
        return { ok: true, mappings: ordered };
    }

    function applyMappings(doc, mappings, appFontInfos) {
        var report = {
            mappings: mappings,
            textRanges: 0,
            paragraphStyles: 0,
            characterStyles: 0,
            compositeEntries: 0,
            errors: []
        };

        for (var i = 0; i < mappings.length; i++) {
            var mapping = mappings[i];

            report.paragraphStyles += replaceInStyles(
                doc.allParagraphStyles,
                mapping,
                appFontInfos,
                report.errors,
                "段落スタイル"
            );
            report.characterStyles += replaceInStyles(
                doc.allCharacterStyles,
                mapping,
                appFontInfos,
                report.errors,
                "文字スタイル"
            );
            report.compositeEntries += replaceInCompositeFonts(
                doc,
                mapping,
                appFontInfos,
                report.errors
            );
            report.textRanges += replaceInText(doc, mapping, report.errors);
        }

        clearFindChangePreferences();
        return report;
    }

    function replaceInStyles(styles, mapping, appFontInfos, errors, kind) {
        var list = collectionToArray(styles);
        var count = 0;

        for (var i = 0; i < list.length; i++) {
            var style = list[i];
            var current = resolveAssignedFont(style, appFontInfos);
            if (!current || current.identityKey !== mapping.source.identityKey) continue;

            try {
                style.appliedFont = mapping.target.font;
                style.fontStyle = mapping.target.fontStyleName;
                count++;
            } catch (error) {
                addError(errors, kind + "「" + safeObjectName(style) + "」", error);
            }
        }
        return count;
    }

    function replaceInCompositeFonts(doc, mapping, appFontInfos, errors) {
        var composites = collectionToArray(doc.compositeFonts);
        var count = 0;

        for (var c = 0; c < composites.length; c++) {
            var entries = collectionToArray(composites[c].compositeFontEntries);
            for (var e = 0; e < entries.length; e++) {
                var entry = entries[e];
                var current = resolveAssignedFont(entry, appFontInfos);
                if (!current || current.identityKey !== mapping.source.identityKey) continue;

                try {
                    entry.appliedFont = mapping.target.font;
                    entry.fontStyle = mapping.target.fontStyleName;
                    count++;
                } catch (error) {
                    addError(
                        errors,
                        "合成フォント「" + safeObjectName(composites[c]) + "」／「" + safeObjectName(entry) + "」",
                        error
                    );
                }
            }
        }
        return count;
    }

    function replaceInText(doc, mapping, errors) {
        // 合成フォントやスタイル内だけに文字列として存在する不足フォントには、
        // 検索条件へ渡せるFontオブジェクトがありません。該当本文も存在しないため省略します。
        if (!mapping.source.font) return 0;

        clearFindChangePreferences();
        try {
            app.findTextPreferences.appliedFont = mapping.source.font;
            app.findTextPreferences.fontStyle = mapping.source.fontStyleName;
            app.changeTextPreferences.appliedFont = mapping.target.font;
            app.changeTextPreferences.fontStyle = mapping.target.fontStyleName;

            var changed = doc.changeText();
            clearFindChangePreferences();
            return changed ? changed.length : 0;
        } catch (error) {
            clearFindChangePreferences();
            addError(errors, "本文「" + mapping.source.displayLabel + "」", error);
            return 0;
        }
    }

    function clearFindChangePreferences() {
        try { app.findTextPreferences = NothingEnum.nothing; } catch (error1) {}
        try { app.changeTextPreferences = NothingEnum.nothing; } catch (error2) {}
    }

    function resolveAssignedFont(owner, appFontInfos) {
        var assigned;
        var styleName;

        try { assigned = owner.appliedFont; } catch (error1) { return null; }
        try { styleName = safeString(owner.fontStyle); } catch (error2) { styleName = ""; }

        if (assigned && typeof assigned !== "string") {
            var directInfo = makeFontInfo(assigned);
            if (directInfo && directInfo.characterSet) return directInfo;
        }

        var assignedName = safeString(assigned);
        if (!assignedName || isNothingValue(assignedName)) return null;

        var normalizedAssigned = normalizeSimple(assignedName);
        var normalizedStyle = normalizeSimple(styleName);
        for (var i = 0; i < appFontInfos.length; i++) {
            var info = appFontInfos[i];
            if (normalizedStyle && info.styleKey !== normalizedStyle) continue;
            if (
                normalizeSimple(info.fontFamily) === normalizedAssigned ||
                normalizeSimple(info.name) === normalizedAssigned ||
                normalizeSimple(info.fullName) === normalizedAssigned ||
                normalizeSimple(info.postscriptName) === normalizedAssigned
            ) {
                return info;
            }
        }

        // 合成フォント内だけで使われる不足フォントはdoc.fontsに現れない場合があります。
        // その場合は、appliedFontの文字列とfontStyleから照合用情報を生成します。
        return makeSyntheticFontInfo(assignedName, styleName);
    }

    function makeSyntheticFontInfo(assignedName, styleName) {
        var familyName = assignedName;
        var resolvedStyle = styleName;

        if (assignedName.indexOf("\t") >= 0) {
            var parts = assignedName.split("\t");
            familyName = parts[0];
            if (!resolvedStyle && parts.length > 1) resolvedStyle = parts[1];
        }

        var info = {
            font: null,
            name: assignedName,
            fontFamily: familyName,
            fontStyleName: resolvedStyle,
            fullName: familyName + (resolvedStyle ? " " + resolvedStyle : ""),
            fullNameNative: "",
            postscriptName: "",
            registry: "",
            ordering: ""
        };

        info.characterSet = detectCharacterSet(info);
        if (!info.characterSet) return null;

        info.isInstalled = false;
        info.styleKey = normalizeSimple(info.fontStyleName);
        info.familyBase = normalizeAfterRemovingCharacterSet(info.fontFamily, info.characterSet);
        info.postscriptBase = "";
        info.identityKey = buildIdentityKey(info);
        info.displayLabel = buildFontDisplayLabel(info);
        return info;
    }

    function makeFontInfo(font) {
        if (!font) return null;

        var info = {
            font: font,
            name: readFontProperty(font, "name"),
            fontFamily: readFontProperty(font, "fontFamily"),
            fontStyleName: readFontProperty(font, "fontStyleName"),
            fullName: readFontProperty(font, "fullName"),
            fullNameNative: readFontProperty(font, "fullNameNative"),
            postscriptName: readFontProperty(font, "postscriptName"),
            registry: readFontProperty(font, "registry"),
            ordering: readFontProperty(font, "ordering")
        };

        // 旧バージョンのInDesignでは、Font.nameが「ファミリー名\tスタイル名」でも
        // fontFamily/fontStyleNameを取得できない場合があるため補完します。
        if ((!info.fontFamily || !info.fontStyleName) && info.name.indexOf("\t") >= 0) {
            var nameParts = info.name.split("\t");
            if (!info.fontFamily) info.fontFamily = nameParts[0];
            if (!info.fontStyleName && nameParts.length > 1) info.fontStyleName = nameParts[1];
        }

        info.characterSet = detectCharacterSet(info);
        if (!info.characterSet) return null;

        info.isInstalled = isInstalledFont(font);
        info.styleKey = normalizeSimple(info.fontStyleName);
        info.familyBase = normalizeAfterRemovingCharacterSet(info.fontFamily, info.characterSet);
        info.postscriptBase = normalizeAfterRemovingCharacterSet(info.postscriptName, info.characterSet);
        info.identityKey = buildIdentityKey(info);
        info.displayLabel = buildFontDisplayLabel(info);
        return info;
    }

    function detectCharacterSet(info) {
        if (!hasJapaneseFontSignal(info)) return "";

        var names = [info.fontFamily, info.fullName, info.fullNameNative, info.postscriptName, info.name];
        for (var t = 0; t < DETECTION_ORDER.length; t++) {
            var token = DETECTION_ORDER[t];
            var pattern = new RegExp(token + "(?=$|[-_\\s])", "i");
            for (var n = 0; n < names.length; n++) {
                if (names[n] && pattern.test(names[n])) return token;
            }
        }
        return "";
    }

    function hasJapaneseFontSignal(info) {
        var visibleNames = [info.fontFamily, info.fullName, info.fullNameNative].join(" ");
        if (/[\u3000-\u30ff\u3400-\u9fff]/.test(visibleNames)) return true;

        var registryAndOrdering = (info.registry + " " + info.ordering).toLowerCase();
        if (registryAndOrdering.indexOf("japan") >= 0) return true;

        var ps = info.postscriptName;
        if (/^(A-OTF-|AP-OTF-|FOT-|Koz|Ryumin|GothicBBB|Hira|DNP|IWATA|TB)/i.test(ps)) return true;
        if (/^(A-OTF-|AP-OTF-|FOT-|Koz|Ryumin|GothicBBB|Hira|DNP|IWATA|TB)/i.test(visibleNames)) return true;
        return false;
    }

    function normalizeAfterRemovingCharacterSet(value, characterSet) {
        var text = safeString(value);
        if (!text) return "";
        var pattern = new RegExp(characterSet + "(?=$|[-_\\s])", "ig");
        return normalizeSimple(text.replace(pattern, ""));
    }

    function normalizeSimple(value) {
        return safeString(value).toLowerCase().replace(/[\s_\-\t]+/g, "");
    }

    function buildIdentityKey(info) {
        if (info.postscriptName) return "ps:" + normalizeSimple(info.postscriptName);
        return "fs:" + normalizeSimple(info.fontFamily) + "|" + normalizeSimple(info.fontStyleName);
    }

    function buildFontDisplayLabel(info) {
        var family = info.fontFamily || info.fullName || info.name || info.postscriptName;
        var style = info.fontStyleName;
        if (style && normalizeSimple(family).indexOf(normalizeSimple(style)) < 0) {
            return family + " / " + style;
        }
        return family;
    }

    function isInstalledFont(font) {
        try {
            // ExtendScriptのEnumeratorは環境により厳密比較で一致しないことがあるため、
            // InDesign DOMの列挙値は通常比較を使います。
            return font.status == FontStatus.INSTALLED;
        } catch (error) {
            return true;
        }
    }

    function readFontProperty(font, propertyName) {
        try { return safeString(font[propertyName]); } catch (error) { return ""; }
    }

    function safeString(value) {
        if (value === undefined || value === null) return "";
        try { return String(value); } catch (error) { return ""; }
    }

    function isNothingValue(value) {
        var text = safeString(value).toLowerCase();
        return text.indexOf("nothingenum") >= 0 || text === "nothing" || text === "1851876449";
    }

    function collectionToArray(collection) {
        if (!collection) return [];
        try {
            return collection.everyItem().getElements();
        } catch (error1) {
            var result = [];
            var length = 0;
            try { length = collection.length; } catch (error2) { return result; }
            for (var i = 0; i < length; i++) {
                try { result.push(collection[i]); } catch (error3) {}
            }
            return result;
        }
    }

    function usageToString(usage) {
        var ordered = ["本文", "段落スタイル", "文字スタイル", "合成フォント"];
        var result = [];
        for (var i = 0; i < ordered.length; i++) {
            if (usage[ordered[i]]) result.push(ordered[i]);
        }
        return result.join("／");
    }

    function characterSetIndex(name) {
        for (var i = 0; i < CHARACTER_SETS.length; i++) {
            if (CHARACTER_SETS[i] === name) return i;
        }
        return 999;
    }

    function safeObjectName(obj) {
        try { return safeString(obj.name) || "名称なし"; } catch (error) { return "名称なし"; }
    }

    function addError(errors, target, error) {
        var message = "";
        try { message = error.message; } catch (error2) { message = safeString(error); }
        errors.push(target + "：" + (message || "変更できませんでした"));
    }

    function buildNoCandidateMessage(sourceData) {
        if (sourceData.list.length === 0) {
            return "対応する文字セット表記を持つ使用フォントが見つかりませんでした。\n\n" +
                "対応表記：Std / StdN / Pro / ProN / Pr5 / Pr5N / Pr6 / Pr6N";
        }
        return "同じ書体系列・同じスタイルの変換候補が見つかりませんでした。\n\n" +
            "変換先フォントがインストールされているか確認してください。";
    }

    function buildReport(report) {
        var lines = [];
        lines.push("置換が完了しました。");
        lines.push("");
        lines.push("指定した対応：" + report.mappings.length + "件");
        lines.push("本文の変更範囲：" + report.textRanges + "件");
        lines.push("段落スタイル：" + report.paragraphStyles + "件");
        lines.push("文字スタイル：" + report.characterStyles + "件");
        lines.push("合成フォント構成：" + report.compositeEntries + "件");

        if (report.errors.length > 0) {
            lines.push("");
            lines.push("変更できなかった項目：" + report.errors.length + "件");
            var limit = Math.min(report.errors.length, 12);
            for (var i = 0; i < limit; i++) lines.push("・" + report.errors[i]);
            if (report.errors.length > limit) {
                lines.push("・ほか " + (report.errors.length - limit) + "件");
            }
        }

        lines.push("");
        lines.push("保存前に、文字化け・リフロー・合成フォントの内容を確認してください。");
        return lines.join("\n");
    }

    main();
}());
