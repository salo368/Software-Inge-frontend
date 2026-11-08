import { parsePendingCdt } from './pending-cdt';

describe('parsePendingCdt', () => {
  it('lee la intención con el formato actual', () => {
    expect(parsePendingCdt('{"bank_id":1,"amount":5000000,"term":360}')).toEqual({
      bank_id: 1,
      amount: 5_000_000,
      term: 360,
    });
  });

  it('acepta el formato anterior (term_days + rate) y descarta la tasa', () => {
    expect(parsePendingCdt('{"bank_id":2,"amount":1000000,"term_days":180,"rate":10.1}')).toEqual({
      bank_id: 2,
      amount: 1_000_000,
      term: 180,
    });
  });

  it('devuelve null con datos ausentes, incompletos o corruptos', () => {
    expect(parsePendingCdt(null)).toBeNull();
    expect(parsePendingCdt('')).toBeNull();
    expect(parsePendingCdt('{not json')).toBeNull();
    expect(parsePendingCdt('{"bank_id":1,"amount":5000000}')).toBeNull();
  });
});
