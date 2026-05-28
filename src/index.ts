import express from "express";
import path from "path";

require("dotenv").config();

const port = "3000";
const public_dir = "public";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

app.use("/api", require("./router/api"));
app.use("/scrape", require("./router/scrape"));

app.get("/", (req, res) => {
  res.sendFile(path.join(public_dir, "index.html"));
});

app.get("/image", (req, res) => {
  const name = req.query.image_name;
  if (!name) {
    res.status(400).send(`Image name not provided!`);
    return;
  }
  res.sendFile(name.toString(), { root: public_dir });
});

app.listen(port, () => {
  console.log(`Geodata scraper app listening on port ${port}`);
});
