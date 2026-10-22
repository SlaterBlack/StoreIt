import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export const DEFAULT_PROJECT_COLOR = '#D87535';

export interface ProjectAttributes {
  id: string;
  projectCode: string;
  name: string;
  description: string;
  color: string;
  isArchived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ProjectCreationAttributes = Optional<
  ProjectAttributes,
  'id' | 'description' | 'color' | 'isArchived' | 'createdAt' | 'updatedAt'
>;

export class ManageProject
  extends Model<ProjectAttributes, ProjectCreationAttributes>
  implements ProjectAttributes
{
  public id!: string;
  public projectCode!: string;
  public name!: string;
  public description!: string;
  public color!: string;
  public isArchived!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ManageProject.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    projectCode: {
      type: DataTypes.STRING(3),
      allowNull: false,
      unique: 'projects_project_code_unique',
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: false,
      defaultValue: DEFAULT_PROJECT_COLOR,
    },
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'manageit_projects',
    timestamps: true,
  },
);
