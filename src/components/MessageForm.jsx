import { useState, useRef, useEffect } from 'react';

export default function MessageForm({ onSubmit }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const textareaRef = useRef(null);

  // 自动聚焦到留言框
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      alert('💖 请写下你想说的话～');
      textareaRef.current?.focus();
      return;
    }

    const trimmedName = name.trim();
    onSubmit({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName || '匿名',
      content: trimmedContent,
      timestamp: Date.now(),
    });

    setName('');
    setContent('');
    textareaRef.current?.focus();
  };

  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      textareaRef.current?.focus();
    }
  };

  const handleContentKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="form-group">
      <div className="form-row">
        <input
          type="text"
          placeholder="你的名字 (可选)"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleNameKeyDown}
        />
        <button className="btn-submit" onClick={handleSubmit}>
          ✉️ 留下心愿
        </button>
      </div>
      <div className="form-row">
        <textarea
          ref={textareaRef}
          placeholder="写下你想说的话… (最多 200 字)"
          maxLength={200}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleContentKeyDown}
        />
      </div>
    </div>
  );
}
