import type { SolutionPlugin } from '../_types';
import meta from './meta';
import Demo from './Demo';
import Architecture from './Architecture';
import Overview from './Overview';

const plugin: SolutionPlugin = {
  meta,
  Demo,
  Architecture,
  Overview,
};

export default plugin;
