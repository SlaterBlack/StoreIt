import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface WorkspaceAttributes {
  id: string;
  name: string;
  ownerId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type WorkspaceCreationAttributes = Optional<WorkspaceAttributes, 'id'>;

export class Workspace
  extends Model<WorkspaceAttributes, WorkspaceCreationAttributes>
  implements WorkspaceAttributes
{
  public id!: string;
  public name!: string;
  public ownerId!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Workspace.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'clockit_workspaces',
    timestamps: true,
  },
);
