import { User } from './User';
import { Workspace } from './Workspace';
import { Project } from './Project';
import { TimeEntry } from './TimeEntry';
import { Task } from './Task';
import { ManageProject } from './ManageProject';
import { ManageTask } from './ManageTask';
import { ManageTaskDependency } from './ManageTaskDependency';

// User <-> Workspace (a user owns many workspaces)
User.hasMany(Workspace, { foreignKey: 'ownerId', as: 'workspaces' });
Workspace.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// Workspace <-> Project
Workspace.hasMany(Project, { foreignKey: 'workspaceId', as: 'projects' });
Project.belongsTo(Workspace, { foreignKey: 'workspaceId', as: 'workspace' });

// User <-> TimeEntry
User.hasMany(TimeEntry, { foreignKey: 'userId', as: 'timeEntries' });
TimeEntry.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Project <-> TimeEntry
Project.hasMany(TimeEntry, { foreignKey: 'projectId', as: 'timeEntries' });
TimeEntry.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Project <-> Task
Project.hasMany(Task, { foreignKey: 'projectId', as: 'tasks' });
Task.belongsTo(Project, { foreignKey: 'projectId', as: 'project' });

// Task <-> TimeEntry (taskId stays nullable for entries created before task assignment was required)
Task.hasMany(TimeEntry, { foreignKey: 'taskId', as: 'timeEntries', onDelete: 'RESTRICT' });
TimeEntry.belongsTo(Task, { foreignKey: 'taskId', as: 'task' });

ManageProject.hasMany(ManageTask, {
  as: 'tasks',
  foreignKey: 'projectId',
  onDelete: 'CASCADE',
});
ManageTask.belongsTo(ManageProject, {
  as: 'project',
  foreignKey: 'projectId',
});
ManageTask.hasMany(ManageTask, {
  as: 'subtasks',
  foreignKey: 'parentTaskId',
  onDelete: 'CASCADE',
});
ManageTask.belongsTo(ManageTask, {
  as: 'parentTask',
  foreignKey: 'parentTaskId',
});
ManageProject.hasMany(ManageTaskDependency, {
  as: 'dependencies',
  foreignKey: 'projectId',
  onDelete: 'CASCADE',
});
ManageTaskDependency.belongsTo(ManageProject, {
  as: 'project',
  foreignKey: 'projectId',
});
ManageTask.hasMany(ManageTaskDependency, {
  as: 'outgoingDependencies',
  foreignKey: 'predecessorTaskId',
  onDelete: 'CASCADE',
});
ManageTask.hasMany(ManageTaskDependency, {
  as: 'incomingDependencies',
  foreignKey: 'successorTaskId',
  onDelete: 'CASCADE',
});
ManageTaskDependency.belongsTo(ManageTask, {
  as: 'predecessor',
  foreignKey: 'predecessorTaskId',
});
ManageTaskDependency.belongsTo(ManageTask, {
  as: 'successor',
  foreignKey: 'successorTaskId',
});

export {
  User,
  Workspace,
  Project,
  Task,
  TimeEntry,
  ManageProject,
  ManageTask,
  ManageTaskDependency,
};
