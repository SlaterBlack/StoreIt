import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface TimeEntryAttributes {
  id: string;
  description: string;
  startTime: Date;
  endTime: Date | null;
  durationSeconds: number | null;
  isBillable: boolean;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TimeEntryCreationAttributes = Optional<
  TimeEntryAttributes,
  'id' | 'description' | 'endTime' | 'durationSeconds' | 'isBillable' | 'projectId'
>;

export class TimeEntry
  extends Model<TimeEntryAttributes, TimeEntryCreationAttributes>
  implements TimeEntryAttributes
{
  public id!: string;
  public description!: string;
  public startTime!: Date;
  public endTime!: Date | null;
  public durationSeconds!: number | null;
  public isBillable!: boolean;
  public userId!: string;
  public projectId!: string | null;
  public taskId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

TimeEntry.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    description: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: '',
    },
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    endTime: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isBillable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    projectId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    taskId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'clockit_time_entries',
    timestamps: true,
  },
);
