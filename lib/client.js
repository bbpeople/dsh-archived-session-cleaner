window.__ModuleLoader__.load({
  id: 'dsh-archived-session-cleaner',
  factory: (require) => {
    var React = require('react');
    // react / react-dom 都是 web 端固定注入的共享模块；弹窗用 createPortal 挂到 body，避免被设置面板裁剪
    var ReactDOM = null;
    try {
      ReactDOM = require('react-dom');
    } catch (err) {
      ReactDOM = null;
    }
    var module = { exports: {} };
    var exports = module.exports;

    // ---------- 工具 ----------
    function apiBase() {
      var p = window.location.pathname;
      var idx = p.lastIndexOf('/');
      var base = idx >= 0 ? p.slice(0, idx + 1) : '/';
      return base + 'sclean/';
    }

    function fmtSize(n) {
      if (!n || n <= 0) return '0 B';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(2) + ' MB';
    }

    function shortId(id) {
      return id.length > 28 ? id.slice(0, 12) + '…' + id.slice(-8) : id;
    }

    // ---------- 左侧导航的分区名与图标 ----------
    // 设置外壳的左侧导航图标是「按注册 id 硬编码」的（account / models / agent-presets /
    // plugins / archived-sessions），其余 id 一律回落到「设置」齿轮，注册项也没有 icon 选项。
    // 所以这里保留插件自己的 id，把外壳渲染的齿轮隐藏，再插入一枚 dsh 同款「归档箱」图标
    // （16px 轮廓、stroke 1.3，取自 dsh 图标集 IconArchiveOutlineMedium 的几何）。
    var NAV_LABEL = '已归档会话';
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var NAV_ICON_PATHS = [
      'M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z',
      'M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5',
      'M6.5 9.5H9.5'
    ];

    function createNavIcon() {
      var svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke-width', '1.3');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'dshsc-nav-icon');
      for (var i = 0; i < NAV_ICON_PATHS.length; i++) {
        var path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', NAV_ICON_PATHS[i]);
        path.setAttribute('stroke', 'currentColor');
        svg.appendChild(path);
      }
      return svg;
    }

    function isOurNavIcon(node) {
      return node.getAttribute('class') === 'dshsc-nav-icon' ||
        (typeof node.classList !== 'undefined' && node.classList !== null && node.classList.contains('dshsc-nav-icon'));
    }

    function patchNavIcon() {
      var cells = document.querySelectorAll('button');
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var label = null;
        var svgs = [];
        for (var j = 0; j < cell.children.length; j++) {
          var child = cell.children[j];
          if (child.tagName === 'SPAN' && child.textContent === NAV_LABEL) label = child;
          if (child.namespaceURI === SVG_NS) svgs.push(child);
        }
        if (label === null) continue;
        var mine = null;
        for (var k = 0; k < svgs.length; k++) {
          if (isOurNavIcon(svgs[k])) mine = svgs[k];
          else svgs[k].style.display = 'none';
        }
        if (mine === null) cell.insertBefore(createNavIcon(), label);
      }
    }

    // 外壳重渲染会重建导航行，所以用 MutationObserver 兜底重打补丁；失败就退回默认齿轮图标
    function startNavIconPatch() {
      if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return null;
      var timer = null;
      var run = function () {
        timer = null;
        try { patchNavIcon(); } catch (e) { /* 外壳结构变化时静默降级 */ }
      };
      var schedule = function () { if (timer === null) timer = setTimeout(run, 60); };
      run();
      var observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      return function () {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
      };
    }

    // 与 dsh 自带会话列表一致：2026年10月22日, 14:50
    function fmtTime(ms) {
      var t = Number(ms);
      if (!t || t <= 0) return '';
      var d = new Date(t);
      if (isNaN(d.getTime())) return '';
      var mm = d.getMinutes();
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日, ' +
        d.getHours() + ':' + (mm < 10 ? '0' + mm : mm);
    }

    // ---------- 样式：全部走 dsh 设计令牌（--dsw-alias-*），随主题明暗切换 ----------
    var styles = document.createElement('style');
    styles.textContent = [
      '.dshsc { --dshsc-fg: var(--dsw-alias-label-primary, #1f2328); --dshsc-fg-2: var(--dsw-alias-label-secondary, #59606a); --dshsc-fg-3: var(--dsw-alias-label-tertiary, #8b939e); --dshsc-line: var(--dsw-alias-border-l2, rgba(128, 138, 152, 0.32)); --dshsc-line-soft: var(--dsw-alias-separator-primary, rgba(128, 138, 152, 0.18)); --dshsc-fill: var(--dsw-alias-settings-card-fill, transparent); --dshsc-fill-stroke: var(--dsw-alias-settings-card-stroke, rgba(128, 138, 152, 0.26)); --dshsc-hover: var(--dsw-alias-interactive-bg-hover, rgba(128, 138, 152, 0.1)); --dshsc-danger: var(--dsw-alias-state-error-primary, #d33b3b); --dshsc-danger-soft: var(--dsw-alias-interactive-bg-hover-danger, rgba(211, 59, 59, 0.1)); --dshsc-warn: var(--dsw-alias-state-warn-label, #b7791f); --dshsc-info: var(--dsw-alias-state-business-primary, #3f74d9); --dshsc-focus: var(--dsw-focus-ring-color, var(--dshsc-info)); --dshsc-radius: var(--dsw-radius-lg, 12px); display: flex; flex-direction: column; gap: 14px; max-width: 760px; color: var(--dshsc-fg); font-size: 13px; line-height: 20px; }',
      '.dshsc *, .dshsc *::before, .dshsc *::after { box-sizing: border-box; }',
      '.dshsc-nav-icon { flex: none; }',
      '.dshsc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }',
      '.dshsc-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
      '.dshsc-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }',
      '.dshsc-h1 { margin: 0; font-size: 18px; font-weight: 600; line-height: 26px; color: var(--dshsc-fg); }',
      '.dshsc-count { min-width: 20px; padding: 0 7px; border-radius: 999px; background: var(--dsw-alias-bg-l2, rgba(128, 138, 152, 0.16)); color: var(--dshsc-fg-2); font-size: 11.5px; font-weight: 600; line-height: 20px; text-align: center; font-variant-numeric: tabular-nums; }',
      '.dshsc-intro { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 0; font-size: 13px; line-height: 20px; color: var(--dshsc-fg-3); font-variant-numeric: tabular-nums; }',
      '.dshsc-actions { display: flex; gap: 8px; flex-shrink: 0; padding-top: 1px; }',
      '.dshsc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; font: inherit; font-size: 12.5px; line-height: 18px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--dshsc-line); background: transparent; color: var(--dshsc-fg-2); cursor: pointer; transition: background 120ms ease, border-color 120ms ease, color 120ms ease; }',
      '.dshsc-btn:hover:not(:disabled) { background: var(--dshsc-hover); color: var(--dshsc-fg); }',
      '.dshsc-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dshsc-focus); outline-offset: 2px; }',
      '.dshsc-btn:disabled { opacity: 0.45; cursor: default; }',
      '.dshsc-btn svg { width: 13px; height: 13px; flex-shrink: 0; }',
      '.dshsc-btn.sm { font-size: 12px; line-height: 16px; padding: 4px 10px; }',
      '.dshsc-btn.danger { border-color: rgba(211, 59, 59, 0.38); color: var(--dshsc-danger); }',
      '.dshsc-btn.danger:hover:not(:disabled) { background: var(--dshsc-danger-soft); border-color: rgba(211, 59, 59, 0.6); color: var(--dshsc-danger); }',
      '.dshsc-btn.ghost-danger { border-color: transparent; color: var(--dshsc-danger); }',
      '.dshsc-btn.ghost-danger:hover:not(:disabled) { background: var(--dshsc-danger-soft); border-color: transparent; color: var(--dshsc-danger); }',
      '.dshsc-btn.spinning svg { animation: dshsc-spin 900ms linear infinite; }',
      '.dshsc-toolbar { display: flex; gap: 8px; }',
      '.dshsc-field { position: relative; display: flex; flex: 1; min-width: 0; }',
      '.dshsc-field > svg { position: absolute; left: 10px; top: 50%; width: 13px; height: 13px; transform: translateY(-50%); color: var(--dshsc-fg-3); pointer-events: none; }',
      '.dshsc-search, .dshsc-select { font: inherit; font-size: 12.5px; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--dshsc-line); background: var(--dshsc-fill); color: var(--dshsc-fg); outline: none; transition: border-color 120ms ease, box-shadow 120ms ease; }',
      '.dshsc-search { flex: 1; min-width: 0; padding-left: 30px; }',
      '.dshsc-search::placeholder { color: var(--dshsc-fg-3); }',
      '.dshsc-search:focus, .dshsc-select:focus { border-color: var(--dshsc-focus); box-shadow: 0 0 0 3px rgba(128, 138, 152, 0.18); }',
      '.dshsc-select { min-width: 132px; max-width: 200px; cursor: pointer; }',
      '.dshsc-msg { margin: 0; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dshsc-line-soft); background: var(--dsw-alias-bg-l2, rgba(128, 138, 152, 0.1)); color: var(--dshsc-fg-2); font-size: 12px; line-height: 18px; }',
      '.dshsc-groups { display: flex; flex-direction: column; gap: 18px; }',
      '.dshsc-group { display: flex; flex-direction: column; gap: 8px; }',
      '.dshsc-group-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }',
      '.dshsc-group-name { font-size: 12.5px; font-weight: 600; color: var(--dshsc-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshsc-group-count { font-size: 11.5px; color: var(--dshsc-fg-3); font-variant-numeric: tabular-nums; }',
      '.dshsc-group-size { margin-left: auto; font-size: 11.5px; color: var(--dshsc-fg-3); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.dshsc-card { margin: 0; padding: 0; list-style: none; border: 1px solid var(--dshsc-fill-stroke); border-radius: var(--dshsc-radius); background: var(--dshsc-fill); overflow: hidden; }',
      '.dshsc-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; transition: background 120ms ease; }',
      '.dshsc-row + .dshsc-row { border-top: 1px solid var(--dshsc-line-soft); }',
      '.dshsc-row:hover { background: var(--dshsc-hover); }',
      '.dshsc-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }',
      '.dshsc-rowtitle { font-size: 13px; line-height: 19px; font-weight: 500; color: var(--dshsc-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshsc-sub { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11.5px; line-height: 17px; color: var(--dshsc-fg-3); white-space: nowrap; }',
      '.dshsc-dot { width: 3px; height: 3px; flex-shrink: 0; border-radius: 50%; background: currentColor; opacity: 0.55; }',
      '.dshsc-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Consolas, monospace); font-size: 11px; }',
      '.dshsc-badge { flex-shrink: 0; padding: 1px 7px; border-radius: 999px; border: 1px solid transparent; font-size: 11px; line-height: 17px; }',
      '.dshsc-badge.disk { color: var(--dshsc-info); background: rgba(63, 116, 217, 0.12); border-color: rgba(63, 116, 217, 0.24); }',
      '.dshsc-badge.ghost { color: var(--dshsc-warn); background: rgba(183, 121, 31, 0.13); border-color: rgba(183, 121, 31, 0.26); }',
      '.dshsc-badge.live { color: var(--dshsc-danger); background: var(--dshsc-danger-soft); border-color: rgba(211, 59, 59, 0.26); }',
      '.dshsc-rowbtns { display: flex; gap: 6px; flex-shrink: 0; }',
      '.dshsc-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 26px 16px; border: 1px dashed var(--dshsc-line); border-radius: var(--dshsc-radius); text-align: center; }',
      '.dshsc-empty-title { font-size: 13px; color: var(--dshsc-fg-2); }',
      '.dshsc-empty-hint { font-size: 12px; line-height: 18px; color: var(--dshsc-fg-3); }',
      '.dshsc-empty .dshsc-btn { margin-top: 4px; }',

      // 确认弹窗：几何与配色照搬 dsh 自带 Modal / Button（panel 圆角、遮罩模糊、toolbar 灰按钮、危险色实心按钮），
      // 但完全由插件自己渲染：不再依赖 dsh 内部模块表，任何版本都能显示，不会退回系统弹窗
      '.dshsc-modal-root { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }',
      '.dshsc-modal-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1, rgba(28, 31, 35, 0.32)); backdrop-filter: var(--dsw-mask-blur, blur(2px)); }',
      '.dshsc-modal { position: relative; z-index: 1; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; width: min(400px, 100%); padding: 22px 24px 24px; border-radius: var(--dsw-radius-panel, 16px); background: var(--dsw-alias-bg-layer-2, var(--dshsc-fill, #fff)); box-shadow: var(--dsw-elevation-prominent, 0 18px 48px rgba(0, 0, 0, 0.24)); }',
      '.dshsc-modal-title { margin: 0; font-size: 16px; font-weight: 500; line-height: 24px; color: var(--dshsc-fg); }',
      '.dshsc-modal-desc { margin: 0; font-size: 14px; line-height: 22px; color: var(--dshsc-fg); }',
      '.dshsc-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; }',
      '.dshsc-modal-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: 0; border-radius: var(--dsw-radius-md, 8px); font: inherit; font-size: 14px; line-height: 22px; color: var(--dshsc-fg); background: var(--dsw-alias-button-tool-bar-fill, rgba(128, 138, 152, 0.14)); cursor: pointer; transition: background 120ms ease; }',
      '.dshsc-modal-btn:hover:not(:disabled) { background: var(--dsw-alias-button-tool-bar-hover, rgba(128, 138, 152, 0.22)); }',
      '.dshsc-modal-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dshsc-focus); outline-offset: 2px; }',
      '.dshsc-modal-btn:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.dshsc-modal-btn.dshsc-modal-danger { background: var(--dsw-alias-state-error-primary, #e5484d); color: var(--dsw-alias-label-primary-foreground, #fff); }',
      '.dshsc-modal-btn.dshsc-modal-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 86%, #000); }',
      '.dshsc-esc { margin-left: 6px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }',
      '@keyframes dshsc-spin { to { transform: rotate(360deg); } }',
      '@media (max-width: 560px) { .dshsc-head { flex-direction: column; align-items: stretch; } .dshsc-actions { justify-content: flex-end; } .dshsc-toolbar { flex-wrap: wrap; } .dshsc-select { flex: 1; max-width: none; } .dshsc-row { flex-wrap: wrap; } .dshsc-rowbtns { margin-left: auto; } }'
    ].join('\n');
    document.head.appendChild(styles);

    // ---------- 图标 ----------
    var iconSearch = React.createElement('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
      React.createElement('circle', { cx: 7.1, cy: 7.1, r: 4.1 }),
      React.createElement('path', { d: 'M10.3 10.3 13.5 13.5' })
    );
    var iconRefresh = React.createElement('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      React.createElement('path', { d: 'M13.2 8.2a5.2 5.2 0 1 1-1.6-3.7' }),
      React.createElement('path', { d: 'M13.2 2.8v3.3h-3.3' })
    );

    // 用 3px 圆点连接多段次要信息
    function withDots(parts) {
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        if (i > 0) out.push(React.createElement('span', { className: 'dshsc-dot', key: 'dot' + i, 'aria-hidden': 'true' }));
        out.push(parts[i]);
      }
      return out;
    }

    // ---------- 已归档会话组件（设置里的独立分区） ----------
    function SessionCleaner() {
      var listPair = React.useState(null);
      var busyPair = React.useState(false);
      var msgPair = React.useState('');
      var qPair = React.useState('');
      var projPair = React.useState('');
      var confirmPair = React.useState(null);
      var list = listPair[0], setList = listPair[1];
      var busy = busyPair[0], setBusy = busyPair[1];
      var msg = msgPair[0], setMsg = msgPair[1];
      var query = qPair[0], setQuery = qPair[1];
      var proj = projPair[0], setProj = projPair[1];
      var confirmIds = confirmPair[0], setConfirmIds = confirmPair[1];

      function load() {
        setBusy(true);
        fetch(apiBase() + 'list').then(function (r) { return r.json(); }).then(function (d) {
          setList(Array.isArray(d.archived) ? d.archived : []);
          setBusy(false);
          if (d.error) setMsg('读取失败: ' + d.error);
        }).catch(function (e) {
          setList([]);
          setBusy(false);
          setMsg('读取失败: ' + e.message);
        });
      }

      function post(path, ids) {
        return fetch(apiBase() + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: ids })
        }).then(function (r) { return r.json(); });
      }

      // 确认弹窗文案：标题 / 说明
      function canUseModal() {
        return ReactDOM !== null && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body !== null;
      }

      function confirmTitle(ids) {
        return ids.length === 1 ? '删除这个归档会话？' : '删除这 ' + ids.length + ' 个归档会话？';
      }

      function confirmDesc(ids) {
        if (ids.length > 1) return '只删除当前确认范围内的会话；磁盘上的会话数据与关联记录会被彻底清除，删除后无法恢复。';
        var one = (list || []).filter(function (x) { return x.id === ids[0]; })[0];
        var name = one && one.title ? '「' + one.title + '」' : '这个归档会话';
        return '将永久删除' + name + '在磁盘上的数据与关联记录，删除后无法恢复。';
      }

      // 点「删除」先弹确认框（插件自绘，样式对齐 dsh 原生弹窗）；极端情况下退回系统 confirm
      function askDelete(ids) {
        if (!ids || ids.length === 0) return;
        if (!canUseModal()) {
          if (!window.confirm(confirmTitle(ids) + '\n' + confirmDesc(ids))) return;
          doDelete(ids);
          return;
        }
        setMsg('');
        setConfirmIds(ids);
      }

      function doDelete(ids) {
        if (!ids || ids.length === 0) return;
        setConfirmIds(null);
        setBusy(true);
        setMsg('');
        post('delete', ids).then(function (d) {
          var ok = Array.isArray(d.results) ? d.results.filter(function (x) { return x.ok; }).length : 0;
          var fail = Array.isArray(d.results) ? d.results.filter(function (x) { return !x.ok; }) : [];
          var needRestart = Array.isArray(d.results) ? d.results.filter(function (x) { return x && x.needsRestart; }).length : 0;
          var m = '删除完成：成功 ' + ok + ' 个' + (fail.length ? '，失败 ' + fail.length + ' 个' + (fail[0].error ? '（' + fail[0].error + '）' : '') : '');
          if (needRestart) m += '；有 ' + needRestart + ' 个会话仍在本进程内存里，重启 dsh 后会从会话列表消失';
          setBusy(false);
          setMsg(m);
          load();
        }).catch(function (e) {
          setBusy(false);
          setMsg('删除失败: ' + e.message);
        });
      }

      function doUnarchive(it) {
        setBusy(true);
        setMsg('');
        post('unarchive', [it.id]).then(function (d) {
          var r = Array.isArray(d.results) ? d.results[0] : null;
          var name = (it && it.title) ? '「' + it.title + '」' : shortId(it.id);
          setBusy(false);
          if (r && r.ok) {
            setMsg(r.alreadyUnarchived
              ? '该会话已不在归档集中（' + name + '），列表已刷新'
              : '已取消归档 ' + name + (d.needsRestart
                ? '；当前 dsh 进程尚未同步，重启后会话会回到会话列表'
                : '，会话已回到会话列表'));
            load();
          } else {
            setMsg('取消归档失败: ' + ((r && r.error) || d.error || '未知错误'));
          }
        }).catch(function (e) {
          setBusy(false);
          setMsg('取消归档失败: ' + e.message);
        });
      }

      React.useEffect(function () {
        load();
      }, []);

      var items = list || [];
      var totalSize = 0;
      for (var i = 0; i < items.length; i++) totalSize += (items[i].diskSize || 0);
      var deletable = items.filter(function (it) { return !it.live; });

      // 项目下拉选项（来自全部条目，不受搜索影响）
      var projects = [];
      var seenProject = {};
      for (var j = 0; j < items.length; j++) {
        var pid = items[j].projectId;
        if (!pid || seenProject[pid]) continue;
        seenProject[pid] = true;
        projects.push({ id: pid, title: items[j].project || '未命名项目' });
      }
      projects.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh'); });

      // 搜索 + 项目筛选
      var q = String(query || '').trim().toLowerCase();
      var filtered = items.filter(function (it) {
        if (proj && it.projectId !== proj) return false;
        if (!q) return true;
        var hay = (it.title || '') + ' ' + it.id + ' ' + (it.project || '');
        return hay.toLowerCase().indexOf(q) >= 0;
      });

      // 按项目分组，组内按最近活动时间倒序
      var groups = [];
      var groupIndex = {};
      filtered.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).forEach(function (it) {
        var key = it.projectId || '__none__';
        if (!groupIndex[key]) {
          groupIndex[key] = { key: key, title: it.project || '未归属项目', rows: [], size: 0 };
          groups.push(groupIndex[key]);
        }
        groupIndex[key].rows.push(it);
        groupIndex[key].size += (it.diskSize || 0);
      });
      groups.sort(function (a, b) {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return String(a.title).localeCompare(String(b.title), 'zh');
      });

      function renderRow(it) {
        var title = it.title || shortId(it.id);
        var meta = [];
        var when = fmtTime(it.at);
        if (when) meta.push(React.createElement('span', { key: 'when' }, when));
        meta.push(React.createElement('span', { className: 'dshsc-id', key: 'id', title: it.id }, shortId(it.id)));
        if (it.diskSize > 0) meta.push(React.createElement('span', { key: 'size' }, fmtSize(it.diskSize)));
        var badge = it.live
          ? React.createElement('span', { className: 'dshsc-badge live' }, '运行中')
          : it.onDisk
            ? React.createElement('span', { className: 'dshsc-badge disk' }, '磁盘数据')
            : React.createElement('span', {
              className: 'dshsc-badge ghost',
              title: it.inMemory
                ? '磁盘数据已不存在，但会话实例还留在 dsh 进程内存里（点「删除」可从内存与归档集一并摘掉；不然重启 dsh 也会消失）'
                : '只剩归档标记，磁盘上已无该会话的数据'
            }, '仅归档标记');
        return React.createElement('div', { className: 'dshsc-row', key: it.id },
          React.createElement('div', { className: 'dshsc-main' },
            React.createElement('div', { className: 'dshsc-rowtitle', title: title }, title),
            React.createElement('div', { className: 'dshsc-sub' }, withDots(meta))
          ),
          badge,
          React.createElement('div', { className: 'dshsc-rowbtns' },
            React.createElement('button', {
              className: 'dshsc-btn sm',
              disabled: busy,
              title: '从归档集移除，会话回到普通会话列表（建议随后重启 dsh 以同步界面）',
              onClick: function () { doUnarchive(it); }
            }, '取消归档'),
            React.createElement('button', {
              className: 'dshsc-btn sm ghost-danger',
              disabled: busy || it.live,
              title: it.live ? '会话正在运行中（turn 未结束），不能删除' : '永久删除磁盘数据与归档记录',
              onClick: function () { askDelete([it.id]); }
            }, '删除')
          )
        );
      }

      // 标题下方那行：会话数 / 磁盘占用 / 筛选结果
      var introParts = [];
      if (list === null) {
        introParts.push(React.createElement('span', { key: 'loading' }, busy ? '正在读取归档列表…' : '没读到归档列表，点右上角「刷新」重试'));
      } else if (items.length === 0) {
        introParts.push(React.createElement('span', { key: 'none' }, '暂无归档会话'));
      } else {
        introParts.push(React.createElement('span', { key: 'count' }, '共 ' + items.length + ' 个会话'));
        introParts.push(React.createElement('span', { key: 'size' }, '磁盘占用 ' + fmtSize(totalSize)));
        if (filtered.length !== items.length) {
          introParts.push(React.createElement('span', { key: 'filtered' }, '筛选后 ' + filtered.length + ' 个'));
        }
      }

      // 空状态
      var empty = null;
      if (list === null) {
        empty = React.createElement('div', { className: 'dshsc-empty' },
          React.createElement('div', { className: 'dshsc-empty-hint' }, busy ? '正在读取归档列表…' : '点右上角「刷新」重新读取')
        );
      } else if (items.length === 0) {
        empty = React.createElement('div', { className: 'dshsc-empty' },
          React.createElement('div', { className: 'dshsc-empty-hint' }, '在会话列表里把会话「归档」后，它会出现在这里')
        );
      } else if (filtered.length === 0) {
        empty = React.createElement('div', { className: 'dshsc-empty' },
          React.createElement('div', { className: 'dshsc-empty-title' }, '没有匹配的会话'),
          React.createElement('div', { className: 'dshsc-empty-hint' }, '换个关键词，或把项目筛选改回「全部项目」'),
          React.createElement('button', {
            className: 'dshsc-btn sm',
            onClick: function () { setQuery(''); setProj(''); }
          }, '清除筛选条件')
        );
      }

      // Esc 取消：弹窗打开期间监听 document
      React.useEffect(function () {
        if (confirmIds === null) return undefined;
        var onKey = function (e) {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          setConfirmIds(null);
        };
        document.addEventListener('keydown', onKey);
        return function () { document.removeEventListener('keydown', onKey); };
      }, [confirmIds]);

      // 确认弹窗：几何 / 配色照搬 dsh 自带 Modal 与 Button，但完全由插件渲染并 portal 到 body
      function renderConfirmDialog() {
        if (confirmIds === null || !canUseModal()) return null;
        var ids = confirmIds;
        var dialog = React.createElement('div', { className: 'dshsc-modal-root', role: 'presentation' },
          React.createElement('div', {
            className: 'dshsc-modal-mask',
            'aria-hidden': 'true',
            onClick: function () { setConfirmIds(null); }
          }),
          React.createElement('div', {
            className: 'dshsc-modal',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': confirmTitle(ids)
          },
            React.createElement('h2', { className: 'dshsc-modal-title' }, confirmTitle(ids)),
            React.createElement('p', { className: 'dshsc-modal-desc' }, confirmDesc(ids)),
            React.createElement('div', { className: 'dshsc-modal-footer' },
              React.createElement('button', {
                type: 'button',
                className: 'dshsc-modal-btn',
                disabled: busy,
                onClick: function () { setConfirmIds(null); }
              }, '取消', React.createElement('span', { className: 'dshsc-esc' }, 'esc')),
              React.createElement('button', {
                type: 'button',
                className: 'dshsc-modal-btn dshsc-modal-danger',
                disabled: busy,
                autoFocus: true,
                onClick: function () { doDelete(ids); }
              }, busy ? '删除中…' : '删除')
            )
          )
        );
        return ReactDOM.createPortal(dialog, document.body);
      }

      return React.createElement('div', { className: 'dshsc' },
        React.createElement('div', { className: 'dshsc-head' },
          React.createElement('div', { className: 'dshsc-heading' },
            React.createElement('div', { className: 'dshsc-title-row' },
              React.createElement('h2', { className: 'dshsc-h1' }, NAV_LABEL),
              items.length ? React.createElement('span', { className: 'dshsc-count', title: '归档会话总数' }, String(items.length)) : null
            ),
            React.createElement('p', { className: 'dshsc-intro' }, withDots(introParts))
          ),
          React.createElement('div', { className: 'dshsc-actions' },
            React.createElement('button', {
              className: 'dshsc-btn' + (busy ? ' spinning' : ''),
              disabled: busy,
              onClick: load,
              title: '重新读取归档列表'
            }, iconRefresh, '刷新'),
            React.createElement('button', {
              className: 'dshsc-btn danger',
              disabled: busy || deletable.length === 0,
              title: deletable.length ? '永久删除全部可删除的归档会话' : '没有可删除的会话',
              onClick: function () { askDelete(deletable.map(function (x) { return x.id; })); }
            }, '删除全部' + (deletable.length ? '（' + deletable.length + '）' : ''))
          )
        ),
        React.createElement('div', { className: 'dshsc-toolbar' },
          React.createElement('div', { className: 'dshsc-field' },
            iconSearch,
            React.createElement('input', {
              className: 'dshsc-search',
              type: 'search',
              placeholder: '搜索标题、会话 ID 或项目',
              value: query,
              disabled: items.length === 0,
              onChange: function (e) { setQuery(e.target.value); }
            })
          ),
          React.createElement('select', {
            className: 'dshsc-select',
            value: proj,
            disabled: projects.length === 0,
            onChange: function (e) { setProj(e.target.value); }
          },
            React.createElement('option', { value: '' }, '全部项目'),
            projects.map(function (p) { return React.createElement('option', { key: p.id, value: p.id }, p.title); })
          )
        ),
        msg ? React.createElement('div', { className: 'dshsc-msg' }, msg) : null,
        empty,
        groups.length
          ? React.createElement('div', { className: 'dshsc-groups' },
            groups.map(function (g) {
              return React.createElement('div', { className: 'dshsc-group', key: g.key },
                React.createElement('div', { className: 'dshsc-group-head' },
                  React.createElement('span', { className: 'dshsc-group-name', title: g.title }, g.title),
                  React.createElement('span', { className: 'dshsc-group-count' }, g.rows.length + ' 个'),
                  React.createElement('span', { className: 'dshsc-group-size' }, fmtSize(g.size))
                ),
                React.createElement('div', { className: 'dshsc-card' }, g.rows.map(renderRow))
              );
            })
          )
          : null,
        renderConfirmDialog()
      );
    }

    // ---------- 插件入口：在设置左侧导航注册独立分区 + 替换导航图标 ----------
    // settings.section 是 root 作用域的 list 插槽（由 settings 外壳声明），
    // 注册项带 id/order/label，外壳据此渲染左侧导航行与右侧内容区。
    function apply(ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      var setup = function () {
        var disposeSection = slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'session-cleaner', order: 16, label: NAV_LABEL },
            function () { return React.createElement(SessionCleaner); }
          );
        });
        var disposeNavPatch = startNavIconPatch();
        return function () {
          if (typeof disposeNavPatch === 'function') disposeNavPatch();
          if (typeof disposeSection === 'function') disposeSection();
        };
      };
      // 用 ctx.effect 绑定生命周期：插件停用/重载时自动注销分区、撤销图标补丁，避免重复
      if (typeof ctx.effect === 'function') {
        ctx.effect(setup, 'dsh-archived-session-cleaner: settings section + nav icon');
      } else {
        setup();
      }
    }

    exports.apply = apply;
    // rc.3 起客户端 fiber 只注入已声明的服务；slots 是硬依赖，必须声明
    exports.inject = ["slots"];
    return module.exports;
  }
});