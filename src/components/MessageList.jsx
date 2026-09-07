import MessageItem from './MessageItem';

export default function MessageList({ messages, onDelete, onClear }) {
  const sorted = [...messages].sort((a, b) => b.timestamp - a.timestamp);

  const handleClear = () => {
    if (messages.length === 0) {
      alert('🎄 已经是空的了～');
      return;
    }
    if (window.confirm('确定要清空所有心愿吗？ 🧹')) {
      onClear();
    }
  };

  return (
    <div className="messages-section">
      <div className="messages-header">
        <h2>💬 心愿墙</h2>
        <span className="count">{messages.length} 条心愿</span>
        <button className="btn-clear" onClick={handleClear}>
          🧹 清空
        </button>
      </div>

      <div className="messages-list">
        {sorted.length === 0 ? (
          <div className="empty-message">
            <span>🎀</span>
            还没有心愿呢 … 快来写下第一个吧！
          </div>
        ) : (
          sorted.map((msg) => (
            <MessageItem key={msg.id} message={msg} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  );
}
