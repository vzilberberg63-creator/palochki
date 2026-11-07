import { coinsForWin } from '../src/core/economy';
import { generateLevel } from '../src/core/level';
import { Session } from '../src/core/session';
import { DEFAULT_SKIN, SKINS, isSkinId, skinById } from '../src/core/skins';
import { emptyProgress, mergeProgress, normalizeProgress } from '../src/platform/platform';

describe('Стили палочек', () => {
  it('стандартный бесплатный, остальные дорожают по порядку', () => {
    expect(SKINS[0].id).toBe(DEFAULT_SKIN);
    expect(SKINS[0].price).toBe(0);
    for (let i = 1; i < SKINS.length; i++) expect(SKINS[i].price).toBeGreaterThan(SKINS[i - 1].price);
  });

  it('у каждого стиля корректные цвета и размеры', () => {
    const ids = new Set(SKINS.map((s) => s.id));
    expect(ids.size).toBe(SKINS.length);
    for (const s of SKINS) {
      expect(s.stops[0][0]).toBe(0);
      expect(s.stops[s.stops.length - 1][0]).toBe(1);
      for (let i = 1; i < s.stops.length; i++) expect(s.stops[i][0]).toBeGreaterThanOrEqual(s.stops[i - 1][0]);
      expect(s.tipWidth).toBeLessThan(s.endWidth);
      expect(s.sheen).toBeGreaterThanOrEqual(0);
      expect(s.sheen).toBeLessThanOrEqual(1);
    }
  });

  it('неизвестный стиль заменяется стандартным', () => {
    expect(skinById('nope').id).toBe(DEFAULT_SKIN);
    expect(isSkinId('bamboo')).toBe(true);
    expect(isSkinId('nope')).toBe(false);
  });
});

describe('Монеты', () => {
  it('за проигрыш монет нет, за победу больше со звёздами и очками', () => {
    expect(coinsForWin(0, 500)).toBe(0);
    expect(coinsForWin(1, 0)).toBe(10);
    expect(coinsForWin(3, 0)).toBe(20);
    expect(coinsForWin(3, 1520)).toBe(35);
  });

  it('первый платный стиль — за несколько уровней, а не за один', () => {
    const perLevel = coinsForWin(3, 600);
    const bamboo = skinById('bamboo').price;
    expect(bamboo / perLevel).toBeGreaterThan(3);
    expect(bamboo / perLevel).toBeLessThan(8);
  });
});

describe('Прогресс: монеты и стили', () => {
  it('выбранный стиль должен быть куплен, мусор отбрасывается', () => {
    const p = normalizeProgress({ coins: 50, skins: ['bamboo', 'bamboo', 'fake', 7], skin: 'jade', rev: 3 });
    expect(p.coins).toBe(50);
    expect(p.skins).toEqual(['classic', 'bamboo']);
    expect(p.skin).toBe('classic');
    expect(p.rev).toBe(3);
    expect(normalizeProgress({ coins: -5, rev: 1.5 }).coins).toBe(0);
  });

  it('монеты и выбор берутся из более свежей копии, покупки объединяются', () => {
    // На телефоне купили бамбук (монеты потрачены), в облаке — старая копия с большим балансом.
    const phone = { ...emptyProgress(), coins: 30, skins: ['classic', 'bamboo'] as const, skin: 'bamboo' as const, rev: 9 };
    const cloud = { ...emptyProgress(), coins: 150, skins: ['classic', 'steel'] as const, skin: 'steel' as const, rev: 5 };
    const m = mergeProgress({ ...phone, skins: [...phone.skins] }, { ...cloud, skins: [...cloud.skins] });
    expect(m.coins).toBe(30);
    expect(m.skin).toBe('bamboo');
    expect(m.skins).toEqual(['classic', 'bamboo', 'steel']);
    expect(m.rev).toBe(9);
  });
});

describe('Продление за рекламу', () => {
  function timeOut(s: Session): void {
    while (s.status === 'playing') s.update(0.5);
  }

  it('возвращает игру с нужным временем на часах, один раз', () => {
    const s = new Session(generateLevel(5));
    timeOut(s);
    expect(s.status).toBe('lost');
    expect(s.canContinue()).toBe(true);
    s.continueWithTime(30);
    expect(s.status).toBe('playing');
    expect(s.timeLeft).toBeCloseTo(30, 5);
    timeOut(s);
    expect(s.status).toBe('lost');
    expect(s.canContinue()).toBe(false);
    s.continueWithTime(30);
    expect(s.status).toBe('lost');
  });

  it('пока игра идёт, продлить нельзя', () => {
    const s = new Session(generateLevel(5));
    expect(s.canContinue()).toBe(false);
  });

  it('после продления не больше двух звёзд', () => {
    const s = new Session(generateLevel(1));
    timeOut(s);
    s.continueWithTime(30);
    const tray = s.trays[0];
    for (const g of s.grains.filter((x) => x.kind === tray.kind)) {
      g.x = s.layout.table.minX + 40;
      g.y = s.layout.table.minY + 40;
      s.pointerDown(g.x, g.y);
      s.pointerMove(tray.x + tray.w / 2, tray.y + tray.h / 2);
      s.update(1 / 60);
      s.pointerUp();
    }
    expect(s.status).toBe('won');
    expect(s.mistakes).toBe(0);
    expect(s.stars()).toBe(2);
  });
});
