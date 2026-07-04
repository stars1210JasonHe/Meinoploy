import { detectLang } from '../createmod/extract/language';

describe('detectLang', () => {
  test('Chinese text -> zh', () => {
    expect(detectLang('话说天下大势，分久必合，合久必分。'.repeat(50))).toBe('zh');
  });
  test('English text -> en', () => {
    expect(detectLang('It was a bright cold day in April. '.repeat(50))).toBe('en');
  });
  test('mostly-English mixed text -> en', () => {
    expect(detectLang(('The city of 北京 is large. ' + 'word '.repeat(30)).repeat(20))).toBe('en');
  });
});
