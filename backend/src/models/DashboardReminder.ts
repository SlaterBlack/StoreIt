import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface DashboardReminderAttributes {
  id: string;
  text: string;
  startDate: string;
  frequencyUnit: 'days' | 'weeks';
  frequencyInterval: number;
  weekdays: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type DashboardReminderCreationAttributes = Optional<
  DashboardReminderAttributes,
  'id' | 'enabled'
>;

export class DashboardReminder
  extends Model<
    DashboardReminderAttributes,
    DashboardReminderCreationAttributes
  >
  implements DashboardReminderAttributes
{
  public id!: string;
  public text!: string;
  public startDate!: string;
  public frequencyUnit!: 'days' | 'weeks';
  public frequencyInterval!: number;
  public weekdays!: number[];
  public startTime!: string;
  public endTime!: string;
  public timezone!: string;
  public enabled!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

DashboardReminder.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    text: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: '1970-01-05',
    },
    frequencyUnit: {
      type: DataTypes.STRING(5),
      allowNull: false,
      defaultValue: 'weeks',
    },
    frequencyInterval: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    weekdays: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    startTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    endTime: {
      type: DataTypes.STRING(5),
      allowNull: false,
    },
    timezone: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'Australia/Brisbane',
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'clockit_dashboard_reminders',
    timestamps: true,
  },
);
