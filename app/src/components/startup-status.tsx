export function StartupPending() {
  return (
    <div className="openbot-startup" role="status">
      <div className="openbot-startup-panel">
        <p className="openbot-startup-title">正在加载 ChisaBot…</p>
        <p className="openbot-startup-detail">首次打开可能需要一些时间。</p>
        <button
          className="openbot-startup-reload"
          onClick={() => window.location.reload()}
          type="button"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}

export function StartupFailure() {
  return (
    <div className="openbot-startup" role="alert">
      <div className="openbot-startup-panel">
        <p className="openbot-startup-title">无法加载页面</p>
        <p className="openbot-startup-detail">请检查网络连接后重新加载。</p>
        <button
          className="openbot-startup-reload"
          onClick={() => window.location.reload()}
          type="button"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}
