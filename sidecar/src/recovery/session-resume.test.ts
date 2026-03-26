/**
 * Session Resume Tests
 *
 * 測試 --resume 參數注入與移除
 */

import { describe, it, expect } from 'vitest';
import {
  injectResumeParam,
  removeResumeParam,
  hasResumeParam,
  getResumeSessionId,
} from './session-resume.js';

describe('SessionResume', () => {
  describe('injectResumeParam', () => {
    it('在 prompt 之前插入 --resume', () => {
      const args = ['--print', '--verbose', '--model', 'opus', 'do the task'];
      const result = injectResumeParam(args, 'session-abc');

      expect(result).toContain('--resume');
      expect(result).toContain('session-abc');

      // --resume 應在 prompt 之前
      const resumeIdx = result.indexOf('--resume');
      const promptIdx = result.indexOf('do the task');
      expect(resumeIdx).toBeLessThan(promptIdx);
    });

    it('無 sessionId 時回傳原始參數', () => {
      const args = ['--print', '--verbose', 'do the task'];
      const result = injectResumeParam(args, null);
      expect(result).toEqual(args);
    });

    it('undefined sessionId 回傳原始參數', () => {
      const args = ['--print', '--verbose'];
      const result = injectResumeParam(args, undefined);
      expect(result).toEqual(args);
    });

    it('空字串 sessionId 回傳原始參數', () => {
      const args = ['--print'];
      const result = injectResumeParam(args, '');
      expect(result).toEqual(args);
    });

    it('已存在 --resume 時更新其值', () => {
      const args = ['--print', '--resume', 'old-session', 'do the task'];
      const result = injectResumeParam(args, 'new-session');

      const idx = result.indexOf('--resume');
      expect(result[idx + 1]).toBe('new-session');
      // 不應有重複的 --resume
      expect(result.filter(a => a === '--resume').length).toBe(1);
    });

    it('所有參數都是 flag 時追加到末尾', () => {
      const args = ['--print', '--verbose'];
      const result = injectResumeParam(args, 'session-xyz');
      expect(result).toEqual(['--print', '--verbose', '--resume', 'session-xyz']);
    });

    it('空參數陣列', () => {
      const result = injectResumeParam([], 'session-abc');
      expect(result).toEqual(['--resume', 'session-abc']);
    });
  });

  describe('removeResumeParam', () => {
    it('移除 --resume 及其值', () => {
      const args = ['--print', '--resume', 'session-abc', '--verbose'];
      const result = removeResumeParam(args);
      expect(result).toEqual(['--print', '--verbose']);
    });

    it('無 --resume 時回傳原始參數', () => {
      const args = ['--print', '--verbose'];
      const result = removeResumeParam(args);
      expect(result).toEqual(args);
    });

    it('--resume 在末尾（無值）', () => {
      const args = ['--print', '--resume'];
      const result = removeResumeParam(args);
      expect(result).toEqual(['--print']);
    });
  });

  describe('hasResumeParam', () => {
    it('有 --resume 時回傳 true', () => {
      expect(hasResumeParam(['--resume', 'abc'])).toBe(true);
    });

    it('無 --resume 時回傳 false', () => {
      expect(hasResumeParam(['--print', '--verbose'])).toBe(false);
    });
  });

  describe('getResumeSessionId', () => {
    it('回傳 --resume 的值', () => {
      const result = getResumeSessionId(['--print', '--resume', 'sess-123']);
      expect(result).toBe('sess-123');
    });

    it('無 --resume 時回傳 null', () => {
      expect(getResumeSessionId(['--print'])).toBeNull();
    });

    it('--resume 在末尾無值時回傳 null', () => {
      expect(getResumeSessionId(['--resume'])).toBeNull();
    });
  });
});
