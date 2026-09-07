function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageItem({ message, onDelete }) {
  const handleDelete = () => {
    if (window.confirm('确定要删除这条心愿吗？ 🥺')) {
      onDelete(message.id);
    }
  };

  return (
    <div className="message-item">
      <div className="meta">
        <span className="name">{message.name}</span>
        <span className="time">{formatTime(message.timestamp)}</span>
        <button className="delete-btn" onClick={handleDelete} aria-label="删除">
          ✕
        </button>
      </div>
      <div className="content">{message.content}</div>
    </div>
  );
}
