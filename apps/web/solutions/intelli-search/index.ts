import type { SolutionPlugin } from '../_types';
import meta from './meta';
import Demo from './Demo';
import Architecture from './Architecture';
import Overview from './Overview';
import API from './API';

const plugin: SolutionPlugin = {
  meta,
  Demo,
  Architecture,
  Overview,
  API,
};

export default plugin;
