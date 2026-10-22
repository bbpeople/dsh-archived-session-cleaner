window.__ModuleLoader__.load({
  id: 'dsh-archived-session-cleaner',
  factory: (require) => {
    var React = require('react');
    var module = { exports: {} };
    var exports = module.exports;

    // ---------- API 基础路径 ----------
    function apiBase() {
      var p = window.location.pathname;
      var idx = p.lastIndexOf('/');
      var base = idx >= 0 ? p.slice(0, idx + 1) : '/';
      return base + 'sclean/';
    }

    function fmtSize(n) {
      if (!n || n <= 0) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
      return (n / 1024 / 1024).toFixed(2) + ' MB';
    }

    function shortId(id) {
      return id.length > 28 ? id.slice(0, 12) + '…' + id.slice(-8) : id;
    }

    var styles = document.createElement('style');
    styles.textContent = [
      '.dshsc { display: flex; flex-direction: column; gap: 10px; }',
      '.dshsc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--dsh-text-secondary, #8a8f98); }',
      '.dshsc-actions { display: flex; gap: 8px; }',
      '.dshsc-btn { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--dsh-border, #2a2d34); background: var(--dsh-surface, #1f2227); color: var(--dsh-text, #e6e8eb); cursor: pointer; }',
      '.dshsc-btn:hover { background: var(--dsh-surface-hover, #272b31); }',
      '.dshsc-btn.danger { border-color: rgba(224, 76, 76, 0.5); color: #ff8f8f; }',
      '.dshsc-btn.danger:hover { background: rgba(224, 76, 76, 0.12); }',
      '.dshsc-btn:disabled { opacity: 0.5; cursor: default; }',
      '.dshsc-list { display: flex; flex-direction: column; gap: 6px; max-height: 380px; overflow-y: auto; }',
      '.dshsc-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--dsh-border, #2a2d34); border-radius: 8px; background: var(--dsh-surface-raised, #23262c); font-size: 12.5px; }',
      '.dshsc-id { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--dsh-text, #e6e8eb); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.dshsc-badge { font-size: 11px; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }',
      '.dshsc-badge.disk { background: rgba(88, 166, 255, 0.15); color: #7cb3ff; }',
      '.dshsc-badge.ghost { background: rgba(255, 184, 84, 0.14); color: #ffc069; }',
      '.dshsc-badge.live { background: rgba(224, 76, 76, 0.15); color: #ff8f8f; }',
      '.dshsc-size { color: var(--dsh-text-tertiary, #6b7280); font-size: 11.5px; }',
      '.dshsc-msg { font-size: 12.5px; color: var(--dsh-text-secondary, #8a8f98); }',
      '.dshsc-empty { font-size: 12.5px; color: var(--dsh-text-tertiary, #6b7280); padding: 12px 0; }'
    ].join('\n');
    document.head.appendChild(styles);

    // ---------- 会话清理组件 ----------
    function SessionCleaner() {
      var pair = React.useState({ list: null, busy: false, msg: '' });
      var data = pair[0];
      var setData = pair[1];

      function load() {
        setData({ list: null, busy: true, msg: '' });
        fetch(apiBase() + 'list').then(function (r) { return r.json(); }).then(function (d) {
          setData({ list: Array.isArray(d.archived) ? d.archived : [], busy: false, msg: d.error ? '读取失败: ' + d.error : '' });
        }).catch(function (e) {
          setData({ list: [], busy: false, msg: '读取失败: ' + e.message });
        });
      }

      function doDelete(ids) {
        var label = ids.length === 1 ? '这个归档会话' : '这 ' + ids.length + ' 个归档会话';
        if (!window.confirm('确定永久删除' + label + '？\n磁盘上的会话数据与关联记录将被彻底清除，且无法恢复。')) return;
        setData({ list: data.list, busy: true, msg: '' });
        fetch(apiBase() + 'delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: ids })
        }).then(function (r) { return r.json(); }).then(function (d) {
          var ok = Array.isArray(d.results) ? d.results.filter(function (x) { return x.ok; }).length : 0;
          var fail = Array.isArray(d.results) ? d.results.filter(function (x) { return !x.ok; }) : [];
          var m = '删除完成：成功 ' + ok + ' 个' + (fail.length ? '，失败 ' + fail.length + ' 个' + (fail[0].error ? '（' + fail[0].error + '）' : '') : '');
          setData({ list: null, busy: false, msg: m });
          load();
        }).catch(function (e) {
          setData({ list: data.list, busy: false, msg: '删除失败: ' + e.message });
        });
      }

      React.useEffect(function () {
        load();
      }, []);

      var items = data.list || [];
      var deleted = items.filter(function (it) { return !it.live; });

      return React.createElement('div', { className: 'dshsc' },
        React.createElement('div', { className: 'dshsc-head' },
          React.createElement('span', null, '删除已归档的会话（共 ' + items.length + ' 个）'),
          React.createElement('div', { className: 'dshsc-actions' },
            React.createElement('button', { className: 'dshsc-btn', disabled: data.busy, onClick: load }, '刷新'),
            React.createElement('button', { className: 'dshsc-btn danger', disabled: data.busy || deleted.length === 0,
              onClick: function () { doDelete(deleted.map(function (x) { return x.id; })); } },
              '删除全部归档（' + deleted.length + '）')
          )
        ),
        React.createElement('div', { className: 'dshsc-list' },
          items.length === 0 && !data.busy
            ? React.createElement('div', { className: 'dshsc-empty' }, '没有归档会话')
            : items.map(function (it) {
                var badge = it.live
                  ? React.createElement('span', { className: 'dshsc-badge live' }, '运行中')
                  : it.onDisk
                    ? React.createElement('span', { className: 'dshsc-badge disk' }, '磁盘数据')
                    : React.createElement('span', { className: 'dshsc-badge ghost' }, '仅归档标记');
                return React.createElement('div', { key: it.id, className: 'dshsc-item' },
                  React.createElement('span', { className: 'dshsc-id', title: it.id }, shortId(it.id)),
                  badge,
                  React.createElement('span', { className: 'dshsc-size' }, fmtSize(it.diskSize)),
                  React.createElement('button', {
                    className: 'dshsc-btn danger',
                    disabled: data.busy || it.live,
                    onClick: function () { doDelete([it.id]); }
                  }, '删除')
                );
              })
        ),
        data.msg ? React.createElement('div', { className: 'dshsc-msg' }, data.msg) : null
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