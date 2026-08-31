import {Statement} from './Statement';
import {Stat} from './Stat';
import {Contrast} from './Contrast';
import {ListCard} from './ListCard';

/** CardType → 组件。Task 3 的 CARD_TYPES 每一项都必须在这里有实现。 */
export const CARDS = {
  statement: Statement,
  stat: Stat,
  contrast: Contrast,
  list: ListCard,
} as const;
