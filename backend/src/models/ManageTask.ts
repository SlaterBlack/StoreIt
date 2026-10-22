import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export const TASK_STATUSES = ['not_started', 'in_progress', 'complete'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskAttributes {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  isMilestone: boolean;
  isArchived: boolean;
  name: string;
  assignee: string;
  startDate: string;
  dueDate: string;
  progress: number;
  status: TaskStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TaskCreationAttributes = Optional<
  TaskAttributes,
  | 'id'
  | 'parentTaskId'
  | 'isMilestone'
  | 'isArchived'
  | 'assignee'
  | 'progress'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>;

export class ManageTask
  extends Model<TaskAttributes, TaskCreationAttributes>
  implements TaskAttributes
{
  public id!: string;
  public projectId!: string;
  public parentTaskId!: string | null;
  public isMilestone!: boolean;
  public isArchived!: boolean;
  public name!: string;
  public assignee!: string;
  public startDate!: string;
  public dueDate!: string;
  public progress!: number;
  public status!: TaskStatus;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ManageTask.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    parentTaskId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    isMilestone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    assignee: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: '',
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    progress: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100,
      },
    },
    status: {
      type: DataTypes.ENUM(...TASK_STATUSES),
      allowNull: false,
      defaultValue: 'not_started',
    },
  },
  {
    sequelize,
    tableName: 'manageit_tasks',
    timestamps: true,
  },
);
