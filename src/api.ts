import express from "express";
import {
  get_common_data,
  get_rentable_objects,
  insert_data_to_db,
  remove_temp_table,
  RentableObject,
} from "./db/postgres-fetch";
import { FeatureCollection, GeometryObject } from "geojson";
import { fetch_osm_tags } from "./services/osm_tag_fetcher";
import { fetch_from_osm } from "./services/osm_data_fetcher";
import {
  AdditionalCriterion,
  AdditionalPOI,
  calculate_scores,
} from "./services/score_calculator";
const router = express.Router();

router.post("/scores", async (req, res) => {
  try {
    const additional_poi_config: AdditionalPOI | null = req.body.custom_poi;
    console.log(additional_poi_config);
    let objects_of_same_type: FeatureCollection<GeometryObject>;
    if (req.body.fetched_objects_of_same_type) {
      objects_of_same_type = req.body.fetched_objects_of_same_type;
    } else {
      const object_type: string = req.body.object_type;
      objects_of_same_type = await fetch_from_osm(
        await fetch_osm_tags(object_type),
      );
    }
    const objects_of_same_type_table = crypto.randomUUID();
    await insert_data_to_db(objects_of_same_type, objects_of_same_type_table);

    const additional_criteria: AdditionalCriterion[] | null =
      req.body.additional_criteria;
    let additional_pois_table: string | null = null;

    let additional_pois: FeatureCollection<GeometryObject> | null = null;
    if (additional_poi_config) {
      if (req.body.additional_pois) {
        additional_pois = req.body.additional_pois;
      } else {
        additional_pois = await fetch_from_osm(
          await fetch_osm_tags(additional_poi_config.value),
        );
      }
      additional_pois_table = crypto.randomUUID();
      if (additional_pois) {
        await insert_data_to_db(additional_pois, additional_pois_table);
      }
    }

    const rentables: RentableObject[] = await get_rentable_objects(
      objects_of_same_type_table,
      additional_pois_table,
      additional_poi_config ? additional_poi_config.fast : false,
      additional_criteria ?? [],
    );
    await remove_temp_table(objects_of_same_type_table);
    if (additional_pois_table) {
      await remove_temp_table(additional_pois_table);
    }

    let ratings: number[] = req.body.ratings;
    if (!ratings || ratings.find((r) => r == null)) {
      ratings = [1.667, 2.5, 1.5];
    }
    calculate_scores(
      rentables,
      await get_common_data(),
      ratings,
      additional_criteria,
      additional_poi_config != null,
    );

    res.json({
      rentables,
      objects_of_same_type,
      additional_pois,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error fetching data from database. \n\n ${err}`);
  }
});

module.exports = router;
