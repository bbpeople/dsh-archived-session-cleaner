window.__ModuleLoader__.load({
  id: 'dsh-archived-session-cleaner',
  factory: (require) => {
    var React = require('react');
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

    // ---------- 会话清理组件（设置里的独立分区） ----------
    function SessionCleaner() {
      var listPair = React.useState(null);
      var busyPair = React.useState(false);
      var msgPair = React.useState('');
      var qPair = React.useState('');
      var projPair = React.useState('');
      var list = listPair[0], setList = listPair[1];
      var busy = busyPair[0], setBusy = busyPair[1];
      var msg = msgPair[0], setMsg = msgPair[1];
      var query = qPair[0], setQuery = qPair[1];
      var proj = projPair[0], setProj = projPair[1];

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

      function doDelete(ids) {
        var one = ids.length === 1
          ? (list || []).filter(function (x) { return x.id === ids[0]; })[0]
          : null;
        var label = ids.length === 1
          ? (one && one.title ? '「' + one.title + '」' : '这个归档会话')
          : '这 ' + ids.length + ' 个归档会话';
        if (!window.confirm('确定永久删除' + label + '？\n磁盘上的会话数据与关联记录将被彻底清除，且无法恢复。')) return;
        setBusy(true);
        setMsg('');
        post('delete', ids).then(function (d) {
          var ok = Array.isArray(d.results) ? d.results.filter(function (x) { return x.ok; }).length : 0;
          var fail = Array.isArray(d.results) ? d.results.filter(function (x) { return !x.ok; }) : [];
          var m = '删除完成：成功 ' + ok + ' 个' + (fail.length ? '，失败 ' + fail.length + ' 个' + (fail[0].error ? '（' + fail[0].error + '）' : '') : '');
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
            : React.createElement('span', { className: 'dshsc-badge ghost' }, '仅归档标记');
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
              onClick: function () { doDelete([it.id]); }
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

      return React.createElement('div', { className: 'dshsc' },
        React.createElement('div', { className: 'dshsc-head' },
          React.createElement('div', { className: 'dshsc-heading' },
            React.createElement('div', { className: 'dshsc-title-row' },
              React.createElement('h2', { className: 'dshsc-h1' }, '会话清理'),
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
              onClick: function () { doDelete(deletable.map(function (x) { return x.id; })); }
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
          : null
      );
    }

    // ---------- 插件入口：在设置左侧导航注册独立分区「会话清理」 ----------
    // settings.section 是 root 作用域的 list 插槽（由 settings 外壳声明），
    // 注册项带 id/order/label，外壳据此渲染左侧导航行与右侧内容区。
    function apply(ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      var registerSection = function () {
        return slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'session-cleaner', order: 16, label: '会话清理' },
            function () { return React.createElement(SessionCleaner); }
          );
        });
      };
      // 用 ctx.effect 绑定注册的生命周期：插件停用/重载时自动注销，避免重复分区
      if (typeof ctx.effect === 'function') {
        ctx.effect(registerSection, 'dsh-archived-session-cleaner: settings section');
      } else {
        registerSection();
      }
    }

    exports.apply = apply;
    // rc.3 起客户端 fiber 只注入已声明的服务；slots 是硬依赖，必须声明
    exports.inject = ["slots"];
    return module.exports;
  }
});