import { Router } from "express";
import {
  createProject,
  createProjectTask,
  deleteProject,
  deleteProjectTask,
  listProjectTasks,
  listProjects,
  updateProject,
  updateProjectTask,
} from "../controllers/project.controller";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);
router.get("/", listProjects);
router.post("/", createProject);
router.patch("/:id", updateProject);
router.get("/:projectId/tasks", listProjectTasks);
router.post("/:projectId/tasks", createProjectTask);
router.patch("/:projectId/tasks/:taskId", updateProjectTask);
router.delete("/:projectId/tasks/:taskId", deleteProjectTask);
router.delete("/:id", deleteProject);

export default router;
