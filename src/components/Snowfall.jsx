import { useMemo } from 'react';

/**
 * 雪花飘落组件
 *  - 用 useMemo 生成一次随机配置数组，避免每次渲染重复生成
 *  - 通过 CSS 动画实现飘落效果，不直接操作 DOM
 */
const FLAKE_CHARS = ['❄', '❅', '❆', '✦'];
const FLAKE_COUNT = 55;

export default function Snowfall() {
  const flakes = useMemo(() => {
    return Array.from({ length: FLAKE_COUNT }, (_, i) => {
      const size = 14 + Math.random() * 18;           // 14px ~ 32px
      const left = Math.random() * 100;                // 0% ~ 100%
      const duration = 6 + Math.random() * 12;         // 6s ~ 18s
      const delay = Math.random() * 10;                // 0s ~ 10s
      const opacity = 0.5 + Math.random() * 0.5;       // 0.5 ~ 1.0
      const char = FLAKE_CHARS[Math.floor(Math.random() * FLAKE_CHARS.length)];
      return { id: i, size, left, duration, delay, opacity, char };
    });
  }, []);

  return (
    <div className="snow-container" aria-hidden="true">
      {flakes.map((f) => (
        <span
          key={f.id}
          className="snowflake"
          style={{
            fontSize: `${f.size}px`,
            left: `${f.left}%`,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
            opacity: f.opacity,
          }}
        >
          {f.char}
        </span>
      ))}
    </div>
  );
}
