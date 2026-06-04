export class ScoreCalculationCommonData {
  total_sofia_population: number;
  min_rent: number;
  max_rent: number;

  constructor(tsp: number, min_rent: number, max_rent: number) {
    this.total_sofia_population = tsp;
    this.min_rent = min_rent;
    this.max_rent = max_rent;
  }
}
