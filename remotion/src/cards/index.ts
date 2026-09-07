import {Statement} from './Statement';
import {Stat} from './Stat';
import {Contrast} from './Contrast';
import {ListCard} from './ListCard';
import {Ring} from './Ring';
import {Odometer} from './Odometer';
import {Entity} from './Entity';

/** CardType → 组件。Task 3 的 CARD_TYPES 每一项都必须在这里有实现。 */
export const CARDS = {
  statement: Statement,
  stat: Stat,
  contrast: Contrast,
  list: ListCard,
  ring: Ring,
  odometer: Odometer,
  // TODO(三十三期 Task 4): 换成真实组件
  curve: Statement,
  // TODO(三十三期 Task 4): 换成真实组件
  rank: Statement,
  entity: Entity,
} as const;
