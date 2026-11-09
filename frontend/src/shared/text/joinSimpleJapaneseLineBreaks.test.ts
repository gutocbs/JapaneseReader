import { describe, expect, it } from 'vitest';
import { joinSimpleJapaneseLineBreaks } from './joinSimpleJapaneseLineBreaks';

describe('joinSimpleJapaneseLineBreaks', () => {
  it('joins the first Japanese line-break example from the reading experiment', () => {
    const source = '歩あるいて５分ふんくらいの距離（きょり）きょりなら来きてもらうこともできるかもしれないですが\nチームのメンバーに迷惑（めいわく）めいわくをかけてしまうんじゃないかとか、仕事しごとが遅おくれて（おくれて）しまうんじゃないかとか、いろいろと心配しんぱいしてました';
    expect(joinSimpleJapaneseLineBreaks(source)).toBe('歩あるいて５分ふんくらいの距離（きょり）きょりなら来きてもらうこともできるかもしれないですがチームのメンバーに迷惑（めいわく）めいわくをかけてしまうんじゃないかとか、仕事しごとが遅おくれて（おくれて）しまうんじゃないかとか、いろいろと心配しんぱいしてました');
  });

  it('joins the second Japanese line-break example from the reading experiment', () => {
    const source = 'ちょっと風邪かぜをひいていても、できるんじゃないかなと思おもうので\nツナの缶詰（かんづめ）かんづめを食たべました';
    expect(joinSimpleJapaneseLineBreaks(source)).toBe('ちょっと風邪かぜをひいていても、できるんじゃないかなと思おもうのでツナの缶詰（かんづめ）かんづめを食たべました');
  });

  it('preserves blank lines as paragraph boundaries', () => {
    expect(joinSimpleJapaneseLineBreaks('一行目です\n\n二行目です')).toBe('一行目です\n\n二行目です');
  });

  it('collapses multiple blank LF lines into one paragraph boundary', () => {
    expect(joinSimpleJapaneseLineBreaks('一行目です\n\n\n二行目です\n\n\n\n三行目です'))
      .toBe('一行目です\n\n二行目です\n\n三行目です');
  });

  it('collapses multiple blank CRLF lines without changing the newline convention', () => {
    expect(joinSimpleJapaneseLineBreaks('一行目です\r\n\r\n\r\n二行目です'))
      .toBe('一行目です\r\n\r\n二行目です');
  });

  it('joins a CRLF simple line break between Japanese characters', () => {
    expect(joinSimpleJapaneseLineBreaks('なので\r\nツナです')).toBe('なのでツナです');
  });

  it('does not alter line breaks with spaces, Latin text, or punctuation at their boundary', () => {
    const source = '日本語  \nテキスト\nLatin\n日本語\n。次です';
    expect(joinSimpleJapaneseLineBreaks(source)).toBe(source);
  });
});
