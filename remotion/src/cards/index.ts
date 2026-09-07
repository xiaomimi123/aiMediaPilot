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
  // TODO(三十三期 Task 3/4): 换成真实组件
  ring: Statement,
  // TODO(三十三期 Task 3/4): 换成真实组件
  odometer: Statement,
  // TODO(三十三期 Task 3/4): 换成真实组件
  curve: Statement,
  // TODO(三十三期 Task 3/4): 换成真实组件
  rank: Statement,
  // TODO(三十三期 Task 3/4): 换成真实组件
  entity: Statement,
} as const;
