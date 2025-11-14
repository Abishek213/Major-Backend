import express from "express";
import {
  getCategories,
  createCategory,
  deactivateCategory,
  reactivateCategory,
} from "../controller/categories.controller.js";

const router = express.Router();

router.get("/", getCategories);
router.post("/", createCategory);
router.patch("/:id/deactivate", deactivateCategory);
router.patch("/:id/reactivate", reactivateCategory);

export default router;