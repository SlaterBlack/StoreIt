import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface TaskDependencyAttributes {
  id: string;
  projectId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TaskDependencyCreationAttributes = Optional<
  TaskDependencyAttributes,
  'id' | 'createdAt' | 'updatedAt'
>;

export class ManageTaskDependency
  extends Model<TaskDependencyAttributes, TaskDependencyCreationAttributes>
  implements TaskDependencyAttributes
{
  public id!: string;
  public projectId!: string;
  public predecessorTaskId!: string;
  public successorTaskId!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ManageTaskDependency.init(
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
    predecessorTaskId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    successorTaskId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'manageit_task_dependencies',
    timestamps: true,
    indexes: [
      {
        name: 'task_dependencies_project_pair_unique',
        unique: true,
        fields: ['project_id', 'predecessor_task_id', 'successor_task_id'],
      },
    ],
  },
);
