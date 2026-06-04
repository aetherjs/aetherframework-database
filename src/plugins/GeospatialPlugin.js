/**
 * @license MIT
 * Copyright (c) 2026-present AetherFramework Contributors.
 * SPDX-License-Identifier: MIT
 * @module @aetherframework/database/plugin/GeospatialPlugin
 */
import { BasePlugin } from "./BasePlugin.js";


export class GeospatialPlugin extends BasePlugin {
  constructor(queryBuilder) {
    super(queryBuilder);
    this.pluginName = "GeospatialPlugin";
  }

  _registerMethods() {
    // 注册地理空间查询方法到 QueryBuilder
    this.queryBuilder.whereDistance = this.whereDistance.bind(this);
    this.queryBuilder.whereWithin = this.whereWithin.bind(this);
    this.queryBuilder.whereIntersects = this.whereIntersects.bind(this);
    this.queryBuilder.orderByDistance = this.orderByDistance.bind(this);
    this.queryBuilder.selectDistance = this.selectDistance.bind(this);
  }

  /**
   * WHERE 距离条件（适用于 MySQL/PostgreSQL）
   * @param {string} column - 几何列名
   * @param {Object} point - 点坐标 {latitude, longitude} 或 {x, y}
   * @param {number} distance - 距离（米）
   * @param {string} operator - 比较运算符 (<, <=, >, >=, =)
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  whereDistance(column, point, distance, operator = "<") {
    const { latitude, longitude, x, y } = point;
    const lat = latitude !== undefined ? latitude : y;
    const lng = longitude !== undefined ? longitude : x;

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      // MySQL 空间扩展
      this.queryBuilder.whereRaw(
        `ST_Distance_Sphere(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?)) ${operator} ?`,
        [`POINT(${lng} ${lat})`, distance]
      );
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      // PostgreSQL PostGIS
      this.queryBuilder.whereRaw(
        `ST_Distance(${this.queryBuilder.wrapColumn(column)}::geography, ST_MakePoint(?, ?)::geography) ${operator} ?`,
        [lng, lat, distance]
      );
    }

    return this.queryBuilder;
  }

  /**
   * WHERE 在多边形内条件
   * @param {string} column - 几何列名
   * @param {Array} polygon - 点数组 [{latitude, longitude}, ...]
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  whereWithin(column, polygon) {
    const points = polygon
      .map((p) => {
        const { latitude, longitude, x, y } = p;
        const lat = latitude !== undefined ? latitude : y;
        const lng = longitude !== undefined ? longitude : x;
        return `${lng} ${lat}`;
      })
      .join(", ");

    const polygonWkt = `POLYGON((${points}))`;

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.whereRaw(
        `ST_Within(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?))`,
        [polygonWkt]
      );
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.whereRaw(
        `ST_Within(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?, 4326))`,
        [polygonWkt]
      );
    }

    return this.queryBuilder;
  }

  /**
   * WHERE 与几何图形相交条件
   * @param {string} column - 几何列名
   * @param {Object} geometry - 几何对象
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  whereIntersects(column, geometry) {
    let geometryWkt;

    if (geometry.type === "point") {
      const { latitude, longitude, x, y } = geometry;
      const lat = latitude !== undefined ? latitude : y;
      const lng = longitude !== undefined ? longitude : x;
      geometryWkt = `POINT(${lng} ${lat})`;
    } else if (geometry.type === "polygon") {
      const points = geometry.coordinates
        .map((p) => {
          const { latitude, longitude, x, y } = p;
          const lat = latitude !== undefined ? latitude : y;
          const lng = longitude !== undefined ? longitude : x;
          return `${lng} ${lat}`;
        })
        .join(", ");
      geometryWkt = `POLYGON((${points}))`;
    } else if (geometry.type === "linestring") {
      const points = geometry.coordinates
        .map((p) => {
          const { latitude, longitude, x, y } = p;
          const lat = latitude !== undefined ? latitude : y;
          const lng = longitude !== undefined ? longitude : x;
          return `${lng} ${lat}`;
        })
        .join(", ");
      geometryWkt = `LINESTRING(${points})`;
    }

    if (geometryWkt) {
      if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
        this.queryBuilder.whereRaw(
          `ST_Intersects(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?))`,
          [geometryWkt]
        );
      } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
        this.queryBuilder.whereRaw(
          `ST_Intersects(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?, 4326))`,
          [geometryWkt]
        );
      }
    }

    return this.queryBuilder;
  }

  /**
   * 按距离排序
   * @param {string} column - 几何列名
   * @param {Object} point - 点坐标
   * @param {string} direction - 排序方向 (asc, desc)
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  orderByDistance(column, point, direction = "asc") {
    const { latitude, longitude, x, y } = point;
    const lat = latitude !== undefined ? latitude : y;
    const lng = longitude !== undefined ? longitude : x;

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.orderByRaw(
        `ST_Distance_Sphere(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?)) ${direction.toUpperCase()}`,
        [`POINT(${lng} ${lat})`]
      );
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.orderByRaw(
        `ST_Distance(${this.queryBuilder.wrapColumn(column)}::geography, ST_MakePoint(?, ?)::geography) ${direction.toUpperCase()}`,
        [lng, lat]
      );
    }

    return this.queryBuilder;
  }

  /**
   * 在 SELECT 中计算距离
   * @param {string} column - 几何列名
   * @param {Object} point - 点坐标
   * @param {string} alias - 列别名
   * @returns {QueryBuilder} QueryBuilder 实例
   */
  selectDistance(column, point, alias = "distance") {
    const { latitude, longitude, x, y } = point;
    const lat = latitude !== undefined ? latitude : y;
    const lng = longitude !== undefined ? longitude : x;

    if (["mysql", "mariadb"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.selectRaw(
        `ST_Distance_Sphere(${this.queryBuilder.wrapColumn(column)}, ST_GeomFromText(?)) as ${alias}`,
        [`POINT(${lng} ${lat})`]
      );
    } else if (["postgresql", "postgres", "pg"].includes(this.queryBuilder.dialect)) {
      this.queryBuilder.selectRaw(
        `ST_Distance(${this.queryBuilder.wrapColumn(column)}::geography, ST_MakePoint(?, ?)::geography) as ${alias}`,
        [lng, lat]
      );
    }

    return this.queryBuilder;
  }

  /**
   * 获取支持的地理空间函数
   * @returns {Array} 支持的函数列表
   */
  getSupportedFunctions() {
    const functions = {
      mysql: ["ST_Distance_Sphere", "ST_Within", "ST_Intersects", "ST_GeomFromText"],
      mariadb: ["ST_Distance_Sphere", "ST_Within", "ST_Intersects", "ST_GeomFromText"],
      postgresql: ["ST_Distance", "ST_Within", "ST_Intersects", "ST_MakePoint", "ST_GeomFromText"],
      postgres: ["ST_Distance", "ST_Within", "ST_Intersects", "ST_MakePoint", "ST_GeomFromText"],
      pg: ["ST_Distance", "ST_Within", "ST_Intersects", "ST_MakePoint", "ST_GeomFromText"],
    };

    return functions[this.queryBuilder.dialect] || [];
  }

  /**
   * 检查数据库是否支持地理空间查询
   * @returns {boolean} 是否支持
   */
  isGeospatialSupported() {
    const supportedDialects = ["mysql", "mariadb", "postgresql", "postgres", "pg"];
    return supportedDialects.includes(this.queryBuilder.dialect);
  }
}
