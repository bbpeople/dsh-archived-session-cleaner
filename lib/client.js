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

    // 与 dsh 自带列表一致的样式：2026年10月22日, 14:50
    function fmtTime(ms) {
      var t = Number(ms);
      if (!t || t <= 0) return '';
      var d = new Date(t);
      if (isNaN(d.getTime())) return '';
      var mm = d.getMinutes();
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日, ' +
        d.getHours() + ':' + (mm < 10 ? '0' + mm : mm);
    }

    var styles = document.createElement('style');
    styles.textContent = [
      '.dshsc { display: flex; flex-direction: column; gap: 12px; }',
      '.dshsc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }',
      '.dshsc-h1 { font-size: 15px; font-weight: 600; color: var(--dsh-text, #e6e8eb); }',
      '.dshsc-stat { margin-top: 3px; font-size: 12px; color: var(--dsh-text-tertiary, #6b7280); }',
      '.dshsc-actions { display: flex; gap: 8px; flex-shrink: 0; }',
      '.dshsc-btn { font: inherit; font-size: 12.5px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--dsh-border, #2a2d34); background: var(--dsh-surface, #1f2227); color: var(--dsh-text, #e6e8eb); cursor: pointer; }',
      '.dshsc-btn:hover { background: var(--dsh-surface-hover, #272b31); }',
      '.dshsc-btn.sm { font-size: 12px; padding: 3px 9px; }',
      '.dshsc-btn.danger { border-color: rgba(224, 76, 76, 0.5); color: #ff8f8f; }',
      '.dshsc-btn.danger:hover { background: rgba(224, 76, 76, 0.12); }',
      '.dshsc-btn:disabled { opacity: 0.45; cursor: default; }',
      '.dshsc-toolbar { display: flex; gap: 8px; flex-wrap: wrap; }',
      '.dshsc-search, .dshsc-select { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--dsh-border, #2a2d34); background: var(--dsh-surface, #1f2227); color: var(--dsh-text, #e6e8eb); outline: none; }',
      '.dshsc-search { flex: 1; min-width: 180px; }',
      '.dshsc-search:focus, .dshsc-select:focus { border-color: var(--dsh-accent, #4a7dff); }',
      '.dshsc-select { min-width: 150px; }',
      '.dshsc-msg { font-size: 12.5px; color: var(--dsh-text-secondary, #8a8f98); }',
      '.dshsc-groups { display: flex; flex-direction: column; gap: 16px; max-height: 430px; overflow-y: auto; }',
      '.dshsc-group { display: flex; flex-direction: column; gap: 6px; }',
      '.dshsc-group-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }',
      '.dshsc-group-name { font-weight: 600; color: var(--dsh-text, #e6e8eb); }',
      '.dshsc-group-count { font-size: 11.5px; color: var(--dsh-text-tertiary, #6b7280); }',
      '.dshsc-card { border: 1px solid var(--dsh-border, #2a2d34); border-radius: 10px; background: var(--dsh-surface-raised, #23262c); overflow: hidden; }',
      '.dshsc-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; }',
      '.dshsc-row + .dshsc-row { border-top: 1px solid var(--dsh-border, #2a2d34); }',
      '.dshsc-row:hover { background: var(--dsh-surface-hover, #272b31); }',
      '.dshsc-main { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }',
      '.dshsc-title { font-size: 13px; color: var(--dsh-text, #e6e8eb); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshsc-sub { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--dsh-text-tertiary, #6b7280); min-width: 0; }',
      '.dshsc-id { font-family: ui-monospace, Consolas, monospace; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshsc-time, .dshsc-size { white-space: nowrap; }',
      '.dshsc-badge { font-size: 11px; border-radius: 4px; padding: 1px 6px; white-space: nowrap; flex-shrink: 0; }',
      '.dshsc-badge.disk { background: rgba(88, 166, 255, 0.15); color: #7cb3ff; }',
      '.dshsc-badge.ghost { background: rgba(255, 184, 84, 0.14); color: #ffc069; }',
      '.dshsc-badge.live { background: rgba(224, 76, 76, 0.15); color: #ff8f8f; }',
      '.dshsc-rowbtns { display: flex; gap: 6px; flex-shrink: 0; }',
      '.dshsc-empty { font-size: 12.5px; color: var(--dsh-text-tertiary, #6b7280); padding: 14px 0; }'
    ].join('\n');
    document.head.appendChild(styles);

    // ---------- 会话清理组件 ----------
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
          var name = it.title ? '「' + it.title + '」' : shortId(it.id);
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
          groupIndex[key] = { key: key, title: it.project || '未归属项目', rows: [] };
          groups.push(groupIndex[key]);
        }
        groupIndex[key].rows.push(it);
      });
      groups.sort(function (a, b) {
        if (a.key === '__none__') return 1;
        if (b.key === '__none__') return -1;
        return String(a.title).localeCompare(String(b.title), 'zh');
      });

      function renderRow(it) {
        var sub = [];
        var when = fmtTime(it.at);
        if (when) sub.push(React.createElement('span', { className: 'dshsc-time', key: 'time' }, when));
        sub.push(React.createElement('span', { className: 'dshsc-id', key: 'id', title: it.id }, shortId(it.id)));
        if (it.diskSize > 0) sub.push(React.createElement('span', { className: 'dshsc-size', key: 'size' }, fmtSize(it.diskSize)));
        var badge = it.live
          ? React.createElement('span', { className: 'dshsc-badge live' }, '运行中')
          : it.onDisk
            ? React.createElement('span', { className: 'dshsc-badge disk' }, '磁盘数据')
            : React.createElement('span', { className: 'dshsc-badge ghost' }, '仅归档标记');
        return React.createElement('div', { className: 'dshsc-row', key: it.id },
          React.createElement('div', { className: 'dshsc-main' },
            React.createElement('span', { className: 'dshsc-title', title: it.title || it.id }, it.title || shortId(it.id)),
            React.createElement('div', { className: 'dshsc-sub' }, sub)
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
              className: 'dshsc-btn sm danger',
              disabled: busy || it.live,
              title: it.live ? '会话正在运行中（turn 未结束），不能删除' : '永久删除磁盘数据与归档记录',
              onClick: function () { doDelete([it.id]); }
            }, '删除')
          )
        );
      }

      return React.createElement('div', { className: 'dshsc' },
        React.createElement('div', { className: 'dshsc-head' },
          React.createElement('div', null,
            React.createElement('div', { className: 'dshsc-h1' }, '已归档的会话'),
            React.createElement('div', { className: 'dshsc-stat' },
              items.length === 0
                ? '没有归档会话'
                : '共 ' + items.length + ' 个会话 · 磁盘占用 ' + fmtSize(totalSize)
                  + (filtered.length !== items.length ? ' · 已筛选出 ' + filtered.length + ' 个' : ''))
          ),
          React.createElement('div', { className: 'dshsc-actions' },
            React.createElement('button', { className: 'dshsc-btn', disabled: busy, onClick: load }, '刷新'),
            React.createElement('button', {
              className: 'dshsc-btn danger',
              disabled: busy || deletable.length === 0,
              onClick: function () { doDelete(deletable.map(function (x) { return x.id; })); }
            }, '全部删除' + (deletable.length ? '（' + deletable.length + '）' : ''))
          )
        ),
        React.createElement('div', { className: 'dshsc-toolbar' },
          React.createElement('input', {
            className: 'dshsc-search',
            type: 'search',
            placeholder: '搜索已归档的会话（标题 / id / 项目）',
            value: query,
            disabled: items.length === 0,
            onChange: function (e) { setQuery(e.target.value); }
          }),
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
        list === null && busy ? React.createElement('div', { className: 'dshsc-empty' }, '读取中…') : null,
        list !== null && items.length === 0 ? React.createElement('div', { className: 'dshsc-empty' }, '没有归档会话') : null,
        list !== null && items.length > 0 && filtered.length === 0
          ? React.createElement('div', { className: 'dshsc-empty' }, '没有符合搜索/筛选条件的会话')
          : null,
        React.createElement('div', { className: 'dshsc-groups' },
          groups.map(function (g) {
            return React.createElement('div', { className: 'dshsc-group', key: g.key },
              React.createElement('div', { className: 'dshsc-group-head' },
                React.createElement('span', { className: 'dshsc-group-name' }, g.title),
                React.createElement('span', { className: 'dshsc-group-count' }, g.rows.length + ' 个会话')
              ),
              React.createElement('div', { className: 'dshsc-card' }, g.rows.map(renderRow))
            );
          })
        )
      );
    }

    // ---------- 插件入口：挂到「插件」分组下的独立 tab ----------
    function apply(ctx) {
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      slots.inject('settings.plugins.tab', function () {
        return slots.register(
          { name: 'settings.plugins.tab', id: 'session-cleaner', order: 50, label: '会话清理' },
          function () { return React.createElement(SessionCleaner); }
        );
      });
    }

    exports.apply = apply;
    // rc.3 起客户端 fiber 只注入已声明的服务；slots 是硬依赖，必须声明
    exports.inject = ["slots"];
    return module.exports;
  }
});