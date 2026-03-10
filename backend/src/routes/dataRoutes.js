import { Router } from "express";
import {
  getAllData,
  getDataById,
  createData,
  deleteData,
} from "../controllers/dataController.js";

const router = Router();

router.get("/", getAllData);

router.get("/:id", getDataById);

router.post("/", createData);

router.delete("/:id", deleteData);

export default router;
