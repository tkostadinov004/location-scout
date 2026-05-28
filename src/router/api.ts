import express from "express";
import { get_common_data, get_osm_data, get_rentable_objects, get_rentable_objects_with_additional_pois, remove_temp_table } from "../db/postgres-fetch";
import { calculate_scores } from "../services/score_calculator";
import { osm_data_fetch } from "../services/db_osm_cache";
import { RentableObject } from "../response/RentableObject";
import { AdditionalCriterion } from "../input/AdditionalCriterion";
import { AdditionalPOI } from "../input/AdditionalPOI";
const router = express.Router();

router.post("/objects_of_type", async (req, res) => {
  try {
    const type: string = req.body.object_type;
    const result = await get_osm_data(type);
    res.json({ objects_of_type: JSON.parse(result ?? "{}") });
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error fetching data from database. \n\n ${err}`);
  }
});

router.post("/scores", async (req, res) => {
  try {
    const objects_of_same_type_table: string = await osm_data_fetch(req.body.object_type);
    let additional_pois_table: string | null = null;
    const additional_poi_config: AdditionalPOI | null = req.body.custom_poi;

    const additional_criteria: AdditionalCriterion[] = req.body.additional_criteria ?? [];
    let rentables: RentableObject[];
    if (additional_poi_config) {
      additional_pois_table = await osm_data_fetch(additional_poi_config.value);
      rentables = await get_rentable_objects_with_additional_pois(objects_of_same_type_table, additional_pois_table, additional_poi_config ? additional_poi_config.fast : false, additional_criteria);
    } else {
      rentables = await get_rentable_objects(objects_of_same_type_table, additional_criteria);
    }

    // await remove_temp_table(objects_of_same_type_table);
    if (additional_pois_table) {
      //  await remove_temp_table(additional_pois_table);
    }

    let ratings: number[] = req.body.ratings;
    if (!ratings || ratings.some((r) => r == null)) {
      ratings = [1.667, 2.5, 1.5];
    }
    calculate_scores(rentables, await get_common_data(), ratings, additional_criteria, additional_poi_config != null);

    res.json({ rentables });
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error fetching data from database. \n\n ${err}`);
  }
});

module.exports = router;
