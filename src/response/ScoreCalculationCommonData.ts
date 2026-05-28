export class ScoreCalculationCommonData {
  total_sofia_population: number;
  max_rent: number;
  min_rent: number;

  constructor(tsp: number, max_rent: number, min_rent: number) {
    this.total_sofia_population = tsp;
    this.max_rent = max_rent;
    this.min_rent = min_rent;
  }
}
