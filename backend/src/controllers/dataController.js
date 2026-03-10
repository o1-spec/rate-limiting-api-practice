import { dataRecords } from "../data/mockData.js";

export const getAllData = (req, res) => {
  res.status(200).json({
    count: dataRecords.length,
    records: dataRecords,
  });
};

export const getDataById = (req, res) => {
  const record = dataRecords.find((r) => r.id === req.params.id);

  if (!record) {
    return res.status(404).json({ error: `Record with id '${req.params.id}' not found.` });
  }

  res.status(200).json({ record });
};

export const createData = (req, res) => {
  const { title, category, value, createdBy } = req.body;

  if (!title || !category) {
    return res.status(400).json({ error: "Fields 'title' and 'category' are required." });
  }

  const newRecord = {
    id: `d${Date.now()}`,
    title,
    category,
    value: typeof value === "number" ? value : 0,
    createdBy: createdBy || "anonymous",
    createdAt: new Date().toISOString(),
  };

  dataRecords.push(newRecord);

  res.status(201).json({
    message: "Record created successfully.",
    record: newRecord,
  });
};

export const deleteData = (req, res) => {
  const index = dataRecords.findIndex((r) => r.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: `Record with id '${req.params.id}' not found.` });
  }

  const deleted = dataRecords.splice(index, 1)[0];

  res.status(200).json({
    message: "Record deleted successfully.",
    deleted,
  });
};
