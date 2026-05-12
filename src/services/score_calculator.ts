"use strict";

import {
  RentableObject,
  ScoreCalculationCommonData,
} from "../db/postgres-fetch";

const linear_alg = require("linear-algebra")();
const Matrix = linear_alg.Matrix;
const ahp = require("ahp-lite");

export class AdditionalCriterion {
  type: string;
  value: string;

  constructor(type: string, value: string) {
    this.type = type;
    this.value = value;
  }
}

export class AdditionalPOI {
  value: string;
  fast: boolean;

  constructor(value: string, fast: boolean) {
    this.value = value;
    this.fast = fast;
  }
}

function get_weights(ratings: number[]): number[] {
  const c = new Matrix([
    [1, ratings[0], ratings[1]],
    [1.0 / ratings[0], 1, ratings[2]],
    [1.0 / ratings[1], 1.0 / ratings[2], 1],
  ]);
  return ahp.getWeights(c).ev;
}

function calculate_base_score(
  r: RentableObject,
  weights: number[],
  common_data: ScoreCalculationCommonData,
): number {
  const customers_score: number =
    Math.log(1 + r.approximate_customer_count) /
    Math.log(1 + common_data.total_sofia_population);
  let rent_score: number = 0;
  if (r.rent_per_m2_eur) {
    rent_score =
      1 -
      (r.rent_per_m2_eur * 1.0 - common_data.min_rent) /
        (common_data.max_rent - common_data.min_rent);
  }
  const same_type_objects_score: number =
    1.0 / (1 + r.objects_of_same_type_in_isochrone_count / r.isochrone_area);

  return (
    weights[0] * customers_score +
    weights[1] * rent_score +
    weights[2] * same_type_objects_score
  );
}

export function calculate_scores(
  rentables: RentableObject[],
  common_data: ScoreCalculationCommonData,
  priority_ratings: number[],
  additional_criteria: AdditionalCriterion[] | null,
  is_additional_poi_included: boolean,
) {
  const base_score_weights: number[] = get_weights(priority_ratings);
  rentables.forEach((r) => {
    r.base_score = calculate_base_score(r, base_score_weights, common_data);
    if (!additional_criteria || additional_criteria.length == 0) {
      r.total_score = r.base_score;
    }
  });

  if (!additional_criteria || additional_criteria.length == 0) {
    return;
  }

  const total_criteria_count =
    additional_criteria.length + (is_additional_poi_included ? 1 : 0);
  const additional_criteria_weight: number = 1.0 / total_criteria_count;
  rentables.forEach((r) => {
    let weighted_sum = 0;
    additional_criteria.forEach((ac) => {
      switch (ac.type) {
        case "park":
          weighted_sum +=
            r.shortest_dist_to_park == null
              ? 0
              : additional_criteria_weight *
                (1.0 / (1 + r.shortest_dist_to_park));
          break;
        case "public_transport":
          weighted_sum +=
            r.shortest_dist_to_public_transport == null
              ? 0
              : additional_criteria_weight *
                (1.0 / (1 + r.shortest_dist_to_public_transport));
          break;
        case "school":
          weighted_sum +=
            r.shortest_dist_to_school == null
              ? 0
              : additional_criteria_weight *
                (1.0 / (1 + r.shortest_dist_to_school));
          break;
      }
    });
    if (is_additional_poi_included) {
      weighted_sum +=
        r.min_distance_to_additional_poi == null
          ? 0
          : additional_criteria_weight *
            (1.0 / (1 + r.min_distance_to_additional_poi));
    }
    r.total_score =
      r.base_score == null
        ? 0
        : (r.base_score + weighted_sum) /
          (1 + additional_criteria_weight * total_criteria_count);
  });
}
