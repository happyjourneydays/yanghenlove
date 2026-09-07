import { useState, useEffect, useCallback } from 'react';

/**
 * 一个安全的 localStorage Hook：
 *  - 初始读取使用 lazy initializer（避免 SSR/水合问题）
 *  - 仅在浏览器端真正读写 localStorage
 *  - 封装了 JSON 解析的 try/catch
 */
export default function useLocalStorage(key, initialValue) {
  // lazy 初始化 —— 只在第一次渲染时读取
  const [storedValue, setStoredValue] = useState(() => {
    try {
      if (typeof window === 'undefined') return initialValue;
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch (err) {
      console.warn('useLocalStorage 读取失败:', err);
      return initialValue;
    }
  });

  // 写入 localStorage
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch (err) {
      console.warn('useLocalStorage 写入失败:', err);
    }
  }, [key, storedValue]);

  // 暴露一个 setter（与 setState 用法一致，也支持函数式更新）
  const setValue = useCallback(
    (value) => {
      setStoredValue((prev) =>
        typeof value === 'function' ? value(prev) : value
      );
    },
    []
  );

  return [storedValue, setValue];
}
